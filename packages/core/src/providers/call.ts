import type { ModelBinding, ModelRole } from "@harness/config";
import { APICallError, generateText, type ModelMessage, type ToolSet } from "ai";
import type { Tracer } from "../tracing/tracer.js";
import type { ModelResolver } from "./registry.js";

interface ModelCallInput {
  role: ModelRole;
  /** Tried in order. Entry one is primary; the rest are the failover chain. */
  chain: ModelBinding[];
  system: string;
  messages: ModelMessage[];
  tools?: ToolSet;
}

export interface ModelCallResult {
  text: string;
  toolCalls: Array<{ id: string; name: string; input: unknown }>;
  binding: ModelBinding;
  /** 1 for the primary; higher means the chain failed over to reach an answer. */
  attempt: number;
}

/** An exhausted balance, which every vendor reports as a 400. Matched on message, not status. */
const OUT_OF_CREDIT = /credit balance|insufficient[_ ]quota|billing|exceeded your current quota/i;

/** A model the vendor has retired. Permanent for this entry, not for the chain. */
const MODEL_GONE =
  /no longer available|model[^a-z]*not found|does not exist|unknown model|deprecated/i;

/** Whether the next provider could plausibly do better. See architecture.md#failover. */
export function isWorthFailingOver(error: unknown): boolean {
  if (APICallError.isInstance(error)) {
    if (OUT_OF_CREDIT.test(error.message) || MODEL_GONE.test(error.message)) return true;
    const status = error.statusCode;
    if (status === undefined) return true;
    return status === 408 || status === 409 || status === 429 || status >= 500;
  }
  // Timeouts and transport failures surface as ordinary errors and are worth another provider.
  return true;
}

/**
 * One model call, with the failover chain behind it. The same messages are replayed against the
 * next entry, so a switch is invisible to the customer and visible in the trace.
 */
export async function callModel(
  input: ModelCallInput,
  registry: ModelResolver,
  tracer: Tracer,
): Promise<ModelCallResult> {
  const usable = input.chain.filter((binding) => registry.has(binding.provider));
  if (usable.length === 0) {
    throw new Error(`No provider in the ${input.role} chain has an API key configured`);
  }

  let lastError: unknown;

  for (const [index, binding] of usable.entries()) {
    const attempt = index + 1;
    const startedAt = Date.now();

    try {
      const result = await generateText({
        model: registry.resolve(binding),
        // The instructions block — character, skill docs, retrieved passages — is the largest part
        // of every request and changes rarely. Marking it cacheable is the single biggest latency
        // lever available, and it costs nothing on providers that ignore the hint.
        instructions: {
          role: "system",
          content: input.system,
          ...(binding.provider === "anthropic"
            ? { providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } } }
            : {}),
        },
        messages: input.messages,
        // Reasoning down to the floor on every role: none of them is a reasoning problem, and it
        // was a third of turn latency. See #thinking.
        ...(binding.provider === "google"
          ? {
              providerOptions: {
                google: { thinkingConfig: { thinkingLevel: "minimal", includeThoughts: false } },
              },
            }
          : {}),
        temperature: binding.temperature,
        maxOutputTokens: binding.maxOutputTokens,
        abortSignal: AbortSignal.timeout(binding.timeoutMs),
        // The chain is the retry strategy, and it is the one a reviewer can see. Leaving the
        // SDK's own retries on would trip each provider three times before failing over, which
        // triples the latency of an outage and hides the attempts from the trace.
        maxRetries: 0,
        // No `stopWhen`: one model call per invocation. The reason/act/observe loop is ours to
        // run, and handing it to the SDK would hide the control flow this build is judged on.
        ...(input.tools ? { tools: input.tools } : {}),
      });

      tracer.emit({
        type: "llm_call",
        role: input.role,
        provider: binding.provider,
        model: binding.model,
        attempt,
        prompt: { system: input.system, messages: input.messages },
        completion: result.text,
        toolCalls: result.toolCalls.map((call) => ({
          name: call.toolName,
          // The SDK types a generic tool set's input as `any`; the skill's own schema is what
          // actually validates it, one layer down.
          args: call.input as unknown,
        })),
        ...(result.usage.inputTokens !== undefined
          ? { inputTokens: result.usage.inputTokens }
          : {}),
        ...(result.usage.outputTokens !== undefined
          ? { outputTokens: result.usage.outputTokens }
          : {}),
        latencyMs: Date.now() - startedAt,
      });

      return {
        text: result.text,
        toolCalls: result.toolCalls.map((call) => ({
          id: call.toolCallId,
          name: call.toolName,
          input: call.input as unknown,
        })),
        binding,
        attempt,
      };
    } catch (error) {
      lastError = error;
      const reason = error instanceof Error ? error.message : String(error);

      tracer.emit({
        type: "error",
        stage: `llm_call:${input.role}`,
        message: reason,
        detail: { provider: binding.provider, model: binding.model, attempt },
      });

      const next = usable[index + 1];
      if (!next || !isWorthFailingOver(error)) throw error;

      tracer.emit({
        type: "provider_failover",
        from: { provider: binding.provider, model: binding.model },
        to: { provider: next.provider, model: next.model },
        reason,
      });
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Every provider in the chain failed");
}
