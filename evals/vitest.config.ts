import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["deterministic/**/*.test.ts", "judge/**/*.test.ts"],
    /** Eval cases hit real providers in `--real-model` mode; the default timeout is too short. */
    testTimeout: 30_000,
  },
});
