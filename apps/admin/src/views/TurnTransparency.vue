<script setup lang="ts">
import { computed } from "vue";
import type { TraceEventRow } from "../api";

/**
 * The six transparency claims the brief asks for, laid out as claims rather than left to be
 * reconstructed from the waterfall. Rejected chunks show with the floor drawn through them.
 */

const props = defineProps<{ events: TraceEventRow[]; floor: number }>();

const first = (type: string) => props.events.find((event) => event.type === type);
const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" ? value : null);

const gate = computed(() => first("gate"));
const rag = computed(() => first("rag_retrieve"));

const modelCalls = computed(() =>
  props.events
    .filter((event) => event.type === "llm_call")
    .map((event) => ({
      role: str(event.payload["role"]),
      provider: str(event.payload["provider"]),
      model: str(event.payload["model"]),
      attempt: num(event.payload["attempt"]) ?? 1,
      inputTokens: num(event.payload["inputTokens"]),
      outputTokens: num(event.payload["outputTokens"]),
      costUsd: num(event.payload["costUsd"]),
      latencyMs: event.latencyMs,
      prompt: event.payload["prompt"],
    })),
);

const failovers = computed(() =>
  props.events
    .filter((event) => event.type === "provider_failover")
    .map((event) => ({
      from: event.payload["from"] as { provider: string; model: string },
      to: event.payload["to"] as { provider: string; model: string },
      reason: str(event.payload["reason"]),
    })),
);

const chunks = computed(
  () =>
    (rag.value?.payload["chunks"] ?? []) as Array<{ id: string; source: string; score: number }>,
);

const skills = computed(() =>
  props.events
    .filter((event) => event.type === "tool_result")
    .map((event) => ({
      skill: str(event.payload["skill"]),
      outcome: str(event.payload["outcome"]),
      latencyMs: event.latencyMs,
    })),
);

const guards = computed(() =>
  props.events
    .filter((event) => event.type === "skill_guard")
    .map((event) => ({
      skill: str(event.payload["skill"]),
      guard: str(event.payload["guard"]),
      passed: event.payload["passed"] === true,
      reason: str(event.payload["reason"]),
    })),
);

const prompt = computed(() => {
  const chat = modelCalls.value.find((call) => call.role === "chat") ?? modelCalls.value[0];
  if (!chat) return "";
  return typeof chat.prompt === "string" ? chat.prompt : JSON.stringify(chat.prompt, null, 2);
});
</script>

<template>
  <div class="tp">
    <!-- 1 + 2: which vendor actually served it, and did it switch -->
    <section class="tp-block">
      <h3>Provider and model</h3>
      <table class="data tight">
        <tbody>
          <tr v-for="(call, index) in modelCalls" :key="index">
            <td>
              <span class="chip off">{{ call.role }}</span>
            </td>
            <td>
              <strong>{{ call.provider }}</strong>
              <small class="block dim">{{ call.model }}</small>
            </td>
            <td class="dim">attempt {{ call.attempt }}</td>
            <td class="num dim">
              {{ call.inputTokens ?? "—" }} in / {{ call.outputTokens ?? "—" }} out
            </td>
            <td class="num dim">
              {{ call.costUsd == null ? "—" : `$${call.costUsd.toFixed(5)}` }}
            </td>
            <td class="num">{{ call.latencyMs }}ms</td>
          </tr>
          <tr v-if="modelCalls.length === 0">
            <td class="dim">No model call reached a provider.</td>
          </tr>
        </tbody>
      </table>

      <div v-for="(swap, index) in failovers" :key="index" class="failover-note">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h13l-3-3M20 17H7l3 3" /></svg>
        Switched from <b>{{ swap.from.provider }}/{{ swap.from.model }}</b> to
        <b>{{ swap.to.provider }}/{{ swap.to.model }}</b> — {{ swap.reason }}
      </div>
    </section>

    <!-- 3: the explicit RAG trigger -->
    <section class="tp-block">
      <h3>Did retrieval trigger</h3>
      <div v-if="gate" class="gate-verdict" :class="str(gate.payload['decision'])">
        <strong>{{ str(gate.payload["decision"]) }}</strong>
        <span>decided by {{ str(gate.payload["decidedBy"]) }} in {{ gate.latencyMs }}ms</span>
        <p class="dim">{{ str(gate.payload["reason"]) }}</p>
        <p v-if="str(gate.payload['rewrittenQuery'])" class="dim small">
          rewritten as <code>{{ str(gate.payload["rewrittenQuery"]) }}</code>
        </p>
      </div>
      <p v-else class="dim">The gate did not run.</p>
    </section>

    <!-- 4: chunks and scores, including what was thrown away -->
    <section v-if="rag" class="tp-block">
      <h3>
        Chunks and scores
        <span class="dim small">
          {{ chunks.filter((chunk) => chunk.score >= floor).length }} of {{ chunks.length }} cleared
          the {{ floor }} floor
        </span>
      </h3>
      <div
        v-for="chunk in chunks"
        :key="chunk.id"
        class="chunk"
        :class="{ cut: chunk.score < floor }"
      >
        <span class="chunk-src">{{ chunk.source }}</span>
        <span class="chunk-track">
          <span class="chunk-bar" :style="{ width: `${String(chunk.score * 100)}%` }" />
          <span class="chunk-floor" :style="{ left: `${String(floor * 100)}%` }" />
        </span>
        <span class="chunk-score">{{ chunk.score.toFixed(2) }}</span>
      </div>
      <p v-if="rag.payload['belowFloor'] === true" class="nudge">
        Nothing cleared the floor — the agent was required to decline rather than stretch.
      </p>
    </section>

    <!-- 5: what it was allowed to do, and what it did -->
    <section class="tp-block">
      <h3>Skills fired</h3>
      <table class="data tight">
        <tbody>
          <tr v-for="(skill, index) in skills" :key="index">
            <td>
              <strong>{{ skill.skill }}</strong>
            </td>
            <td>
              <span class="chip" :class="skill.outcome === 'ok' ? 'live' : 'bad'">
                {{ skill.outcome }}
              </span>
            </td>
            <td class="num dim">{{ skill.latencyMs }}ms</td>
          </tr>
          <tr v-if="skills.length === 0">
            <td class="dim">None. The turn was answered without acting.</td>
          </tr>
        </tbody>
      </table>
      <div
        v-for="(guard, index) in guards"
        :key="index"
        class="guard-note"
        :class="{ blocked: !guard.passed }"
      >
        <b>{{ guard.guard }}</b> on {{ guard.skill }} —
        {{ guard.passed ? "passed" : `blocked: ${guard.reason}` }}
      </div>
    </section>

    <!-- 6: the exact prompt, not a summary -->
    <section class="tp-block">
      <h3>Assembled prompt <span class="dim small">exactly what the model saw</span></h3>
      <details>
        <summary>{{ prompt.length.toLocaleString() }} characters</summary>
        <pre>{{ prompt }}</pre>
      </details>
    </section>
  </div>
</template>
