import axios, { type AxiosInstance, isAxiosError } from "axios";
import { GhlApiError, classifyStatus } from "./errors.js";
import type { TokenStore } from "./token-store.js";
import { installationSchema, type StoredInstallation } from "./types.js";

/** Refresh this long before actual expiry so a turn never starts on a token about to die. */
const REFRESH_SKEW_MS = 60_000;

export interface GhlClientOptions {
  apiDomain: string;
  clientId: string;
  clientSecret: string;
  tokens: TokenStore;
}

/**
 * Authenticated access to the GHL REST API, one axios instance per resource (location or company).
 *
 * Token freshness is handled in two places on purpose: proactively before each request using the
 * stored expiry, and reactively on a 401 for the case where GHL revoked early. Concurrent turns
 * for one resource share a single in-flight refresh — without that, a burst of customer messages
 * fires N refreshes and GHL invalidates all but one.
 */
export class GhlClient {
  readonly #opts: GhlClientOptions;
  readonly #instances = new Map<string, AxiosInstance>();
  readonly #refreshes = new Map<string, Promise<StoredInstallation>>();

  constructor(options: GhlClientOptions) {
    this.#opts = options;
  }

  /** Exchanges the authorization code from the OAuth redirect for an installation. */
  async exchangeCode(code: string): Promise<StoredInstallation> {
    const installation = await this.#grant({ grant_type: "authorization_code", code });
    await this.#opts.tokens.save(installation);
    return installation;
  }

  async hasInstallation(resourceId: string): Promise<boolean> {
    return (await this.#opts.tokens.get(resourceId)) !== undefined;
  }

  /**
   * An axios instance scoped to one resource, with auth and error translation attached.
   * Callers pass the GHL API `Version` header per endpoint — it varies by endpoint family.
   */
  requests(resourceId: string): AxiosInstance {
    const existing = this.#instances.get(resourceId);
    if (existing) return existing;

    const instance = axios.create({ baseURL: this.#opts.apiDomain });

    instance.interceptors.request.use(async (config) => {
      const installation = await this.#fresh(resourceId);
      config.headers.set("Authorization", `Bearer ${installation.access_token}`);
      return config;
    });

    instance.interceptors.response.use(
      (response) => response,
      async (error: unknown) => {
        if (!isAxiosError<unknown>(error) || !error.response) throw error;
        const { status, data } = error.response;
        const original = error.config;

        if (status === 401 && original && original.headers["X-Harness-Retried"] !== "1") {
          const installation = await this.#refresh(resourceId);
          original.headers["X-Harness-Retried"] = "1";
          original.headers["Authorization"] = `Bearer ${installation.access_token}`;
          return instance.request(original);
        }

        throw new GhlApiError(
          classifyStatus(status),
          status,
          `GHL ${original?.method?.toUpperCase() ?? "REQUEST"} ${original?.url ?? ""} failed with ${status}`,
          data,
          { cause: error },
        );
      },
    );

    this.#instances.set(resourceId, instance);
    return instance;
  }

  /**
   * Trades a company token for a location token. Only works when the app is distributed to both
   * Company and Location with read-write OAuth scopes.
   */
  async locationTokenFromCompany(companyId: string, locationId: string): Promise<void> {
    const response = await this.requests(companyId).post(
      "/oauth/locationToken",
      new URLSearchParams({ companyId, locationId }),
      { headers: { Version: "2021-07-28" } },
    );
    await this.#opts.tokens.save(this.#toStored(response.data, locationId));
  }

  async #fresh(resourceId: string): Promise<StoredInstallation> {
    const stored = await this.#opts.tokens.get(resourceId);
    if (!stored) throw new Error(`No GHL installation stored for resource ${resourceId}`);
    if (stored.expiresAt.getTime() - Date.now() > REFRESH_SKEW_MS) return stored;
    return this.#refresh(resourceId);
  }

  async #refresh(resourceId: string): Promise<StoredInstallation> {
    const inFlight = this.#refreshes.get(resourceId);
    if (inFlight) return inFlight;

    const refreshing = (async () => {
      const stored = await this.#opts.tokens.get(resourceId);
      if (!stored) throw new Error(`No GHL installation stored for resource ${resourceId}`);
      const refreshed = await this.#grant({
        grant_type: "refresh_token",
        refresh_token: stored.refresh_token,
      });
      const installation = { ...refreshed, resourceId };
      await this.#opts.tokens.save(installation);
      return installation;
    })().finally(() => this.#refreshes.delete(resourceId));

    this.#refreshes.set(resourceId, refreshing);
    return refreshing;
  }

  async #grant(params: Record<string, string>): Promise<StoredInstallation> {
    const response = await axios.post(
      `${this.#opts.apiDomain}/oauth/token`,
      new URLSearchParams({
        client_id: this.#opts.clientId,
        client_secret: this.#opts.clientSecret,
        ...params,
      }),
      { headers: { "content-type": "application/x-www-form-urlencoded" } },
    );
    return this.#toStored(response.data);
  }

  #toStored(payload: unknown, resourceIdOverride?: string): StoredInstallation {
    const installation = installationSchema.parse(payload);
    const resourceId =
      resourceIdOverride ?? installation.locationId ?? installation.companyId ?? undefined;
    if (!resourceId) {
      throw new Error("GHL token response carried neither locationId nor companyId");
    }
    return {
      ...installation,
      resourceId,
      expiresAt: new Date(Date.now() + installation.expires_in * 1000),
    };
  }
}
