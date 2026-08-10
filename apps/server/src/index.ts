import { config } from "dotenv";
import { createApp } from "./app.js";
import { createAppContext } from "./context.js";
import { fromRepoRoot } from "./paths.js";

config({ path: fromRepoRoot(".env") });

const ctx = await createAppContext();
const server = createApp(ctx).listen(ctx.env.PORT, () => {
  ctx.logger.info("harness listening", { port: ctx.env.PORT });
});

/** Drain in-flight requests and release the pool so a redeploy doesn't strand connections. */
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void ctx.close().then(() => process.exit(0));
    });
  });
}
