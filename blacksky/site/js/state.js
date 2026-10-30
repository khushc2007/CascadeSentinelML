// Minimal store with independent slices: set() merges a patch and tells subscribers which slices changed.
export function createStore(initial) {
  let s = { ...initial }; const subs = new Set();
  return {
    get: () => s,
    set(patch) {
      const p = typeof patch === "function" ? patch(s) : patch, changed = new Set();
      for (const k of Object.keys(p)) if (s[k] !== p[k]) changed.add(k);
      if (!changed.size) return; s = { ...s, ...p }; subs.forEach((f) => f(s, changed));
    },
    sub(f) { subs.add(f); return () => subs.delete(f); },
  };
}
