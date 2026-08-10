import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { ModelBinding, ProviderName } from "@harness/config";
import type { LanguageModel } from "ai";

/** The credentials the registry needs. Passed in rather than read from the environment here. */
export interface ProviderCredentials {
  anthropic?: string | undefined;
  openai?: string | undefined;
  google?: string | undefined;
}

/**
 * What the caller needs from a registry: whether a provider is usable, and how to reach it.
 *
 * An interface so a test can drive the real loop with a scripted model, which is the only way to
 * assert on iteration caps and tool-error handling without paying a provider per assertion.
 */
export interface ModelResolver {
  has(provider: ProviderName): boolean;
  resolve(binding: ModelBinding): LanguageModel;
}

/**
 * Resolves a configured model binding to something callable.
 *
 * This file is the only place in the harness that names a vendor. Adding a fourth provider is one
 * entry in this map plus its key — the loop, the tracing, and the eval suite do not change, which
 * is the architectural claim the whole build rests on.
 */
export class ProviderRegistry implements ModelResolver {
  readonly #credentials: ProviderCredentials;
  readonly #cache = new Map<string, LanguageModel>();

  constructor(credentials: ProviderCredentials) {
    this.#credentials = credentials;
  }

  /** True when a key exists for this provider, so a chain can skip an unusable entry. */
  has(provider: ProviderName): boolean {
    return this.#credentials[provider] !== undefined;
  }

  resolve(binding: ModelBinding): LanguageModel {
    const cacheKey = `${binding.provider}:${binding.model}`;
    const cached = this.#cache.get(cacheKey);
    if (cached) return cached;

    const apiKey = this.#credentials[binding.provider];
    if (apiKey === undefined) {
      throw new Error(
        `No API key configured for provider "${binding.provider}". Set it in the environment or remove it from the model chain.`,
      );
    }

    const model = FACTORIES[binding.provider](apiKey, binding.model);
    this.#cache.set(cacheKey, model);
    return model;
  }
}

const FACTORIES: Record<ProviderName, (apiKey: string, model: string) => LanguageModel> = {
  anthropic: (apiKey, model) => createAnthropic({ apiKey })(model),
  openai: (apiKey, model) => createOpenAI({ apiKey })(model),
  google: (apiKey, model) => createGoogleGenerativeAI({ apiKey })(model),
};
