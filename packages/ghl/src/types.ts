import { z } from "zod";

const appUserTypeSchema = z.enum(["Company", "Location"]);

/** The token payload GHL returns from both the authorization-code and refresh grants. */
export const installationSchema = z.object({
  access_token: z.string().min(1),
  token_type: z.literal("Bearer"),
  expires_in: z.number().int().positive(),
  refresh_token: z.string().min(1),
  scope: z.string(),
  userType: appUserTypeSchema,
  companyId: z.string().optional(),
  locationId: z.string().optional(),
});

export type Installation = z.infer<typeof installationSchema>;

/** A stored installation, with the absolute expiry we compute from `expires_in` at grant time. */
export interface StoredInstallation extends Installation {
  /** The resource this installation authenticates for — a locationId or a companyId. */
  resourceId: string;
  expiresAt: Date;
}
