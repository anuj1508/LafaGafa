import { decryptSsoPayload } from "@harness/ghl";
import { Router } from "express";
import { z } from "zod";
import type { AppContext } from "../context.js";

const decryptBodySchema = z.object({ key: z.string().min(1) });

/**
 * Decrypts the SSO blob a GHL-embedded custom page passes us, which is how an embedded page
 * proves which location and user it is rendering for.
 */
export function ssoRoutes(ctx: AppContext): Router {
  const router = Router();

  router.post("/sso/decrypt", (req, res) => {
    const ssoKey = ctx.env.GHL_APP_SSO_KEY;
    if (!ssoKey) {
      res.status(501).json({ error: "GHL_APP_SSO_KEY is not configured on this deployment" });
      return;
    }

    const body = decryptBodySchema.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Expected a 'key' string" });
      return;
    }

    try {
      res.json(decryptSsoPayload(body.data.key, ssoKey));
    } catch (error) {
      ctx.logger.warn("sso decrypt failed", { error: String(error) });
      res.status(400).json({ error: "Invalid SSO key" });
    }
  });

  return router;
}
