import { schema, type Database } from "@harness/db";
import type { StoredInstallation, TokenStore } from "@harness/ghl";
import { eq } from "drizzle-orm";

/** Durable token storage. Installations must survive a restart, or every deploy breaks the app. */
export class PostgresTokenStore implements TokenStore {
  constructor(private readonly db: Database) {}

  async get(resourceId: string): Promise<StoredInstallation | undefined> {
    const [row] = await this.db
      .select()
      .from(schema.installations)
      .where(eq(schema.installations.resourceId, resourceId))
      .limit(1);
    if (!row) return undefined;

    return {
      resourceId: row.resourceId,
      access_token: row.accessToken,
      refresh_token: row.refreshToken,
      token_type: "Bearer",
      // Recomputed from the stored absolute expiry; the original relative value is not kept.
      expires_in: Math.max(0, Math.floor((row.expiresAt.getTime() - Date.now()) / 1000)),
      scope: row.scope,
      userType: row.userType === "Company" ? "Company" : "Location",
      ...(row.companyId ? { companyId: row.companyId } : {}),
      ...(row.locationId ? { locationId: row.locationId } : {}),
      expiresAt: row.expiresAt,
    };
  }

  async save(installation: StoredInstallation): Promise<void> {
    await this.db
      .insert(schema.installations)
      .values({
        resourceId: installation.resourceId,
        userType: installation.userType,
        companyId: installation.companyId ?? null,
        locationId: installation.locationId ?? null,
        accessToken: installation.access_token,
        refreshToken: installation.refresh_token,
        scope: installation.scope,
        expiresAt: installation.expiresAt,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: schema.installations.resourceId,
        set: {
          accessToken: installation.access_token,
          refreshToken: installation.refresh_token,
          scope: installation.scope,
          expiresAt: installation.expiresAt,
          updatedAt: new Date(),
        },
      });
  }
}
