import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The repo root, as seen from this module.
 *
 * The server runs with its own package directory as cwd, so anything cwd-relative — the shared
 * `.env`, a `./settings.yaml` in the operator's config — resolves to the wrong place. Both `src`
 * and `dist` sit three levels below the root, so one constant serves the dev and built paths.
 */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Resolves an operator-supplied path against the repo root, leaving absolute paths alone. */
export function fromRepoRoot(path: string): string {
  return isAbsolute(path) ? path : join(REPO_ROOT, path);
}
