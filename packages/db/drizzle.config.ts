import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
// Extensionless: drizzle-kit bundles this config with esbuild, which resolves the TypeScript
// source directly and does not honour the NodeNext ".js" specifier the rest of the repo uses.
import { sslFor } from "./src/ssl";

// The workspace keeps one .env at the repo root; drizzle-kit runs from this package's directory.
config({ path: "../../.env" });

// Falls back to the docker-compose default rather than throwing: this module is loaded by tooling
// that only reads the schema path (knip, editors) and has no business requiring a live database.
const url = process.env["DATABASE_URL"] ?? "postgres://postgres:postgres@localhost:5432/harness";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./migrations",
  dialect: "postgresql",
  dbCredentials: { url, ssl: sslFor(url, process.env["PGSSLROOTCERT"]) },
});
