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

  // The chat surface cannot be proxied: a CDN buffers the SSE reply stream until it ends, which it
  // never does, so the widget must reach this origin directly. See docs/architecture.md#cors.
  const allowed = new Set(ctx.env.CORS_ALLOWED_ORIGINS);
  if (allowed.size > 0) {
    app.use((req, res, next) => {
      const origin = req.headers.origin;
      if (origin !== undefined && allowed.has(origin)) {
        res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader("Vary", "Origin");
        res.setHeader("Access-Control-Allow-Headers", "content-type");
      }
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
      next();
    });
  }

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
