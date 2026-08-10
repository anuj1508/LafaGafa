import { ref, watch } from "vue";
import { BRIGHTLINE, HARBOUR_ROW, type Org, type OrgType } from "./mock/tenancy";
import { go } from "./router";

/**
 * Who is signed in, and therefore which product they see. Two audiences, two doors, and a nullable
 * `org` that distinguishes signed up from set up. Mocked. See #two-doors.
 */

interface Identity {
  name: string;
  email: string;
  org: Org | null;
}

// Restored across a refresh: there is no auth here to preserve, so a form on reload was friction
// with nothing behind it.
const STORAGE_KEY = "lafagafa.session";

const STAFF_DEFAULT = { name: "Platform", email: "platform@lafagafa.example" };

function restore<T>(key: string, fallback: T): T {
  try {
    const raw = globalThis.sessionStorage.getItem(`${STORAGE_KEY}.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    // A malformed or unavailable store is not worth failing the app over.
    return fallback;
  }
}

export const identity = ref<Identity | null>(restore<Identity | null>("identity", null));
export const staff = ref<{ name: string; email: string } | null>(
  restore<{ name: string; email: string } | null>("staff", STAFF_DEFAULT),
);

for (const [key, source] of [
  ["identity", identity],
  ["staff", staff],
] as const) {
  watch(
    source,
    (value) => {
      try {
        if (value === null) globalThis.sessionStorage.removeItem(`${STORAGE_KEY}.${key}`);
        else globalThis.sessionStorage.setItem(`${STORAGE_KEY}.${key}`, JSON.stringify(value));
      } catch {
        // Persistence is a convenience; losing it must not break navigation.
      }
    },
    { deep: true },
  );
}

export const PERSONAS: Array<{ name: string; email: string; org: Org; blurb: string }> = [
  {
    name: "Rae Whitfield",
    email: "operations@brightline.example",
    org: BRIGHTLINE,
    blurb: "An agency running five client sites. Sees only Brightline's own sub-accounts.",
  },
  {
    name: "Dr Imogen Sale",
    email: "practice@harbourrow.example",
    org: HARBOUR_ROW,
    blurb: "A single practice running its own agent. One sub-account, no agency in between.",
  },
];

export function signIn(who: { name: string; email: string; org: Org }): void {
  identity.value = who;
  go("dashboard");
}

/** An account and nothing more. Everything else is asked once they are inside. */
export function signUp(email: string): void {
  identity.value = { name: email.split("@")[0] ?? "You", email, org: null };
  go("onboarding");
}

/**
 * The end of onboarding's first half: now we know what shape of customer this is.
 *
 * Lands on the fixture org matching that shape, so the rest of the product has data to show.
 */
export function completeProfile(details: {
  name: string;
  type: OrgType;
  industry: string;
  headcount: string;
  useCase: string;
}): void {
  if (!identity.value) return;
  const base = details.type === "agency" ? BRIGHTLINE : HARBOUR_ROW;
  identity.value = {
    ...identity.value,
    org: {
      ...base,
      name: details.name,
      type: details.type,
      industry: details.industry,
      headcount: details.headcount,
      useCase: details.useCase,
      owner: identity.value.email,
      since: "today",
    },
  };
}

export function signInAsStaff(email: string): void {
  staff.value = { name: email.split("@")[0] ?? "Staff", email };
  go("admin/traces");
}

export function signOut(): void {
  identity.value = null;
  staff.value = null;
  go("");
}
