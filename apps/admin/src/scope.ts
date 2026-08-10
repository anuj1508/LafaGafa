import { reactive } from "vue";

/**
 * Where the console is pointed. A place, not a filter — hence names alongside ids, and hence it
 * survives navigation. See docs/architecture.md#scope-is-a-place.
 */
interface Crumb {
  kind: "org" | "account" | "agent";
  id: string;
  label: string;
}

type Source = "live" | "eval" | "all";

interface Scope {
  crumbs: Crumb[];
  source: Source;
  enter(crumb: Crumb): void;
  upTo(index: number): void;
  clear(): void;
  of(kind: Crumb["kind"]): string | undefined;
}

export const scope = reactive<Scope>({
  crumbs: [],
  source: "live",

  enter(crumb: Crumb) {
    const order = ["org", "account", "agent"] as const;
    const depth = order.indexOf(crumb.kind);
    this.crumbs = [...this.crumbs.filter((c) => order.indexOf(c.kind) < depth), crumb];
  },
  /** Click a crumb to go back up to it; everything deeper is dropped. */
  upTo(index: number) {
    this.crumbs = this.crumbs.slice(0, index + 1);
  },
  clear() {
    this.crumbs = [];
  },
  of(kind: Crumb["kind"]): string | undefined {
    return this.crumbs.find((c) => c.kind === kind)?.id;
  },
});
