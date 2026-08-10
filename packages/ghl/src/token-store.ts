import type { StoredInstallation } from "./types.js";

/**
 * Where OAuth installations live. The client never assumes a backing store, so the same client
 * runs against Postgres in the server and against an in-memory store in tests.
 */
export interface TokenStore {
  get(resourceId: string): Promise<StoredInstallation | undefined>;
  save(installation: StoredInstallation): Promise<void>;
}

export class InMemoryTokenStore implements TokenStore {
  readonly #installations = new Map<string, StoredInstallation>();

  get(resourceId: string): Promise<StoredInstallation | undefined> {
    return Promise.resolve(this.#installations.get(resourceId));
  }

  save(installation: StoredInstallation): Promise<void> {
    this.#installations.set(installation.resourceId, installation);
    return Promise.resolve();
  }
}
