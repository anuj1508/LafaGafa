import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { settingsSchema, type Settings } from "./settings.js";

/** Reads and validates the settings file. A bad one fails at boot, with every problem listed. */
export async function loadSettings(
  path: string,
  options: { preferProvider?: string; debounceMs?: number } = {},
): Promise<Settings> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (cause) {
    throw new Error(`Cannot read settings file at ${path}`, { cause });
  }

  const parsed = settingsSchema.safeParse(parseYaml(raw));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid settings in ${path}:\n${issues}`);
  }
  // Overridden from the environment because it is the one tunable a deployment retunes without a
  // code change, and the settings file may be a read-only secret mount. See #slo-clock.
  const settings =
    options.debounceMs === undefined
      ? parsed.data
      : { ...parsed.data, behavior: { ...parsed.data.behavior, debounceMs: options.debounceMs } };

  return options.preferProvider ? promote(settings, options.preferProvider) : settings;
}

/** Moves one provider to the head of the chain. Ignores a name the chain does not hold. */
export function promote(settings: Settings, provider: string): Settings {
  const chosen = settings.model.chain.find((entry) => entry.provider === provider);
  if (!chosen) return settings;
  return {
    ...settings,
    model: {
      ...settings.model,
      chain: [chosen, ...settings.model.chain.filter((entry) => entry !== chosen)],
    },
  };
}
