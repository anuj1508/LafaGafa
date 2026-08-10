import express, { type Express } from "express";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AppContext } from "./context.js";
import { adminRoutes } from "./routes/admin.js";
import { chatRoutes } from "./routes/chat.js";
import { oauthRoutes } from "./routes/oauth.js";
import { ssoRoutes } from "./routes/sso.js";
import { webhookRoutes } from "./routes/webhooks.js";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

export function createApp(ctx: AppContext): Express {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", business: ctx.settings.businessName });
  });

  app.use(adminRoutes(ctx));
  app.use(webhookRoutes(ctx));
  app.use(chatRoutes(ctx));
  app.use(oauthRoutes(ctx));
  app.use(ssoRoutes(ctx));

  // The throwaway page that drives the loop by hand. Phase 5 replaces the skin, not the pipe.
  app.use(express.static(PUBLIC_DIR));

  return app;
}
