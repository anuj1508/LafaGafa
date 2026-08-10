<script setup lang="ts">
import { computed } from "vue";

/**
 * The harness, drawn once and lit up by a trace, so the diagram cannot go stale.
 * The node ids are an API with STAGE: rename one here and the animation silently stops.
 */

const props = defineProps<{
  /** Nodes lit right now, from the event being replayed. */
  active: string[];
  /** Nodes this turn touched at all, so the unused path stays visibly unused. */
  visited: string[];
  failed?: string[];
}>();

const on = (id: string) => (props.active.includes(id) ? "on" : "");
const seen = (id: string) => (props.visited.includes(id) ? "seen" : "");
const bad = (id: string) => (props.failed?.includes(id) ? "bad" : "");
const cls = (id: string) => `node ${on(id)} ${seen(id)} ${bad(id)}`;

const edge = (id: string) =>
  `edge ${props.active.includes(id) ? "on" : ""} ${props.visited.includes(id) ? "seen" : ""}`;

const gateSkipped = computed(
  () => props.visited.includes("gate") && !props.visited.includes("retrieve"),
);
</script>

<template>
  <div class="pipe-wrap">
    <svg viewBox="0 0 980 300" class="pipe" role="img" aria-label="The harness pipeline">
      <defs>
        <marker
          id="ph"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0 0 L10 5 L0 10 z" class="phead" />
        </marker>
      </defs>

      <!-- in -->
      <g :class="cls('webhook')">
        <rect class="bx" x="14" y="112" width="104" height="46" rx="9" />
        <text class="nt" x="66" y="132">webhook</text>
        <text class="ns" x="66" y="148">inbound</text>
      </g>
      <path :class="edge('e-in')" d="M118 135 L156 135" marker-end="url(#ph)" />

      <g :class="cls('dedupe')">
        <rect class="bx" x="156" y="112" width="96" height="46" rx="9" />
        <text class="nt" x="204" y="132">dedupe</text>
        <text class="ns" x="204" y="148">once only</text>
      </g>
      <path :class="edge('e-dedupe')" d="M252 135 L292 135" marker-end="url(#ph)" />

      <!-- the graded decision, drawn as a decision -->
      <g :class="cls('gate')">
        <path class="dia" d="M348 96 L410 135 L348 174 L286 135 Z" />
        <text class="nt" x="348" y="132">gate</text>
        <text class="ns" x="348" y="148">retrieve?</text>
      </g>

      <path :class="edge('e-retrieve')" d="M348 96 L348 58 L436 58" marker-end="url(#ph)" />
      <text class="el" x="356" y="52">yes</text>
      <g :class="cls('retrieve')">
        <rect class="bx" x="436" y="34" width="118" height="46" rx="9" />
        <text class="nt" x="495" y="54">retrieval</text>
        <text class="ns" x="495" y="70">floor 0.35</text>
      </g>
      <path :class="edge('e-kb')" d="M554 57 L604 57" marker-end="url(#ph)" />
      <g :class="cls('kb')">
        <rect class="bx kb" x="604" y="34" width="104" height="46" rx="9" />
        <text class="nt" x="656" y="54">knowledge</text>
        <text class="ns" x="656" y="70">pgvector</text>
      </g>
      <path :class="edge('e-ctx')" d="M495 80 L495 112" marker-end="url(#ph)" />

      <path :class="edge('e-skip')" d="M410 135 L436 135" marker-end="url(#ph)" />
      <text v-if="gateSkipped" class="el skip" x="412" y="128">skipped</text>

      <!-- the loop -->
      <rect class="loopbox" x="424" y="100" width="272" height="122" rx="12" />
      <text class="grp" x="436" y="118">LOOP</text>

      <g :class="cls('model')">
        <rect class="bx" x="436" y="124" width="112" height="46" rx="9" />
        <text class="nt" x="492" y="144">model</text>
        <text class="ns" x="492" y="160">reason</text>
      </g>
      <path :class="edge('e-act')" d="M548 140 L578 140" marker-end="url(#ph)" />
      <path :class="edge('e-obs')" d="M578 156 L548 156" marker-end="url(#ph)" />
      <text class="el" x="552" y="176">observe</text>

      <g :class="cls('skills')">
        <rect class="bx" x="578" y="124" width="106" height="46" rx="9" />
        <text class="nt" x="631" y="144">skills</text>
        <text class="ns" x="631" y="160">guarded</text>
      </g>

      <!-- failover forks off the model, and is only drawn when it happened -->
      <path
        v-if="visited.includes('failover')"
        :class="edge('e-failover')"
        d="M492 124 L492 96 L560 96"
        marker-end="url(#ph)"
      />
      <g v-if="visited.includes('failover')" :class="cls('failover')">
        <rect class="bx alt" x="560" y="76" width="108" height="38" rx="9" />
        <text class="nt sm" x="614" y="100">failover</text>
      </g>

      <path :class="edge('e-out')" d="M696 161 L742 161" marker-end="url(#ph)" />
      <g :class="cls('crm')">
        <rect class="bx" x="742" y="138" width="108" height="46" rx="9" />
        <text class="nt" x="796" y="158">CRM send</text>
        <text class="ns" x="796" y="174">reply out</text>
      </g>

      <!-- handover leaves the pipeline entirely -->
      <path
        v-if="visited.includes('handover')"
        :class="edge('e-handover')"
        d="M631 170 L631 236 L742 236"
        marker-end="url(#ph)"
      />
      <g v-if="visited.includes('handover')" :class="cls('handover')">
        <rect class="bx stop" x="742" y="214" width="108" height="44" rx="9" />
        <text class="nt" x="796" y="234">handover</text>
        <text class="ns" x="796" y="249">agent stops</text>
      </g>

      <path :class="edge('e-trace')" d="M850 161 L898 161" marker-end="url(#ph)" />
      <g :class="cls('trace')">
        <rect class="bx" x="898" y="138" width="70" height="46" rx="9" />
        <text class="nt" x="933" y="158">trace</text>
        <text class="ns" x="933" y="174">stored</text>
      </g>
    </svg>
  </div>
</template>
