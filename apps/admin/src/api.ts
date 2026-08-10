/** Everything the console reads. Thin on purpose: the server owns every read model. */
async function get<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path} returned ${String(response.status)}`);
  return (await response.json()) as T;
}

interface Overview {
  window: string;
  turns: number;
  latency: { p50: number | null; p95: number | null };
  gate: Record<string, number>;
  tokens: { input: number; output: number; calls: number };
  handovers: number;
  errors: number;
}

export interface TurnRow {
  source: string;
  subAccountId: string | null;
  handoverTrigger: string | null;
  turnId: string;
  conversationId: string;
  ts: string;
  events: number;
  input: string | null;
  reply: string | null;
  stopReason: string | null;
  latencyMs: number | null;
  gate: string | null;
  skills: string | null;
  failed: boolean;
}

export interface TraceEventRow {
  id: string;
  turnId: string;
  seq: number;
  type: string;
  ts: string;
  latencyMs: number | null;
  payload: Record<string, unknown>;
}

interface ConversationRow {
  id: string;
  ghlConversationId: string;
  contactId: string;
  aiEnabled: boolean;
  repliesSent: number;
  consecutiveFailures: number;
  handoverReason: string | null;
  updatedAt: string;
}

export interface GapRow {
  id: string;
  locationId: string;
  question: string;
  bestScore: number | null;
  createdAt: string;
}

export interface SubAccountRow {
  id: string;
  name: string;
  ghlLocationId: string | null;
  timezone: string;
}

export interface EvalCaseResult {
  id: string;
  behavior: string;
  turnId: string;
  input: string;
  reply: string;
  passed: boolean;
  failures: string[];
  latencyMs: number;
}

export interface GateReport {
  ranAt: string;
  cases: number;
  accuracy: number;
  precision: number;
  precisionFloor: number;
  recall: number;
  recallFloor: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  falseSkips: Array<{ id: string; input: string; reason: string }>;
  falseRetrieves: Array<{ id: string; input: string; reason: string }>;
}

export interface EvalReport {
  behaviour: EvalCaseResult[] | null;
  gate: GateReport | null;
  provider: string | null;
  /** Every provider with results on disk, so the console can offer a switch. */
  providers: string[];
}

export interface ModelBindingRow {
  provider: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
  configured: boolean;
}

export interface ModelConfig {
  chain: ModelBindingRow[];
  gate: Omit<ModelBindingRow, "configured">;
  judge: Omit<ModelBindingRow, "configured">;
  envOverride: string | null;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const body = (await response.json()) as { error?: string };
    throw new Error(body.error ?? String(response.status));
  }
  return (await response.json()) as T;
}

export const api = {
  model: () => get<ModelConfig>("/api/admin/model"),
  promote: (provider: string) => post<{ ok: boolean }>("/api/admin/model", { provider }),
  overview: () => get<Overview>("/api/admin/overview"),
  turns: (options: { subAccountId?: string; source?: string; conversationId?: string } = {}) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options)) if (value) params.set(key, value);
    const query = params.toString();
    return get<TurnRow[]>(`/api/admin/turns${query ? `?${query}` : ""}`);
  },
  subAccounts: () => get<SubAccountRow[]>("/api/admin/sub-accounts"),
  evals: () => get<EvalReport>("/api/admin/evals"),
  turn: (turnId: string) => get<TraceEventRow[]>(`/api/admin/turns/${turnId}`),
  conversations: () => get<ConversationRow[]>("/api/admin/conversations"),
  gaps: (locationId?: string) =>
    get<GapRow[]>(
      locationId
        ? `/api/admin/gaps?locationId=${encodeURIComponent(locationId)}`
        : "/api/admin/gaps",
    ),
  settings: () => get<Record<string, unknown>>("/api/admin/settings"),
};
