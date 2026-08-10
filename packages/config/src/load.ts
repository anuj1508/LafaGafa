import { readFile } from "node:fs/promises";
import { parse as parseYaml } from "yaml";
import { settingsSchema, type Settings } from "./settings.js";

/** Reads and validates the settings file. A bad one fails at boot, with every problem listed. */
export async function loadSettings(
  path: string,
  options: { preferProvider?: string } = {},
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
  return options.preferProvider ? promote(parsed.data, options.preferProvider) : parsed.data;
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
