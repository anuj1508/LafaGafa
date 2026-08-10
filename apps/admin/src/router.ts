import { ref } from "vue";

/**
 * Hash routing in thirty lines, rather than a router dependency.
 *
 * There are seven screens and no nested layouts, guards or transitions to speak of. A router would
 * be more code to read than this is, and the boundary it draws — "which view is on screen" — is
 * already the only thing being asked.
 */

interface Route {
  path: string;
  params: string[];
}

const parse = (): Route => {
  const raw = globalThis.location.hash.replace(/^#\/?/, "");
  const segments = raw.split("/").filter(Boolean);
  return { path: segments[0] ?? "", params: segments.slice(1) };
};

export const route = ref<Route>(parse());

globalThis.addEventListener("hashchange", () => {
  route.value = parse();
  globalThis.scrollTo({ top: 0 });
});

export function go(path: string): void {
  globalThis.location.hash = `#/${path}`;
}
