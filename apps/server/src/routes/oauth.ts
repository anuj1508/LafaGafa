import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../async-handler.js";
import type { AppContext } from "../context.js";

const callbackQuerySchema = z.object({ code: z.string().min(1) });

/**
 * The marketplace OAuth redirect. GHL sends the operator here after they install the app; we
 * trade the code for tokens and hand them back to the app they came from.
 */
export function oauthRoutes(ctx: AppContext): Router {
  const router = Router();

  router.get(
    "/oauth/callback",
    asyncHandler(async (req, res) => {
      const query = callbackQuerySchema.safeParse(req.query);
      if (!query.success) {
        res.status(400).json({ error: "Missing authorization code" });
        return;
      }

      try {
        const installation = await ctx.ghl.exchangeCode(query.data.code);
        ctx.logger.info("ghl installation stored", {
          resourceId: installation.resourceId,
          userType: installation.userType,
        });
        res.redirect("https://app.gohighlevel.com/");
      } catch (error) {
        ctx.logger.error("oauth exchange failed", { error: String(error) });
        res.status(502).json({ error: "Could not complete the GHL installation" });
      }
    }),
  );

  return router;
}
