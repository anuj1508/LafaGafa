import { reactive } from "vue";
import { api, type EvalReport, type SubAccountRow, type TraceEventRow, type TurnRow } from "./api";
import { scope } from "./scope";

/**
 * One store, filled by loaders, read by views.
 *
 * Waku's dashboard fetches once into a global and renders from it, and the discipline is the point:
 * views never fetch. Forty `onMounted` calls across a console is how you get four spinners racing
 * on one screen and a scope change that updates half of it.
 */
export const store = reactive({
  subAccounts: [] as SubAccountRow[],
  turns: [] as TurnRow[],
  events: [] as TraceEventRow[],
  evals: null as EvalReport | null,
  openTurnId: null as string | null,
  offline: false,
  loading: false,
});

export async function loadTurns(): Promise<void> {
  store.loading = true;
  try {
    const account = scope.of("account");
    store.turns = await api.turns(
      account ? { subAccountId: account, source: scope.source } : { source: scope.source },
    );
    store.offline = false;
  } catch {
    store.offline = true;
  } finally {
    store.loading = false;
  }
}

export async function openTurn(turnId: string): Promise<void> {
  store.openTurnId = turnId;
  store.events = await api.turn(turnId).catch(() => []);
}

export async function loadSubAccounts(): Promise<void> {
  store.subAccounts = await api.subAccounts().catch(() => []);
}

export async function loadEvals(): Promise<void> {
  store.evals = await api.evals().catch(() => null);
}
