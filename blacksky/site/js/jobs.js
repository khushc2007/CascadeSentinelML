// Job manager: runs heavy computations in the compute worker with progress, cancellation and a time limit, one job at a time per type
// family (a new job of the same family cancels the previous one). Without Web Worker support heavy jobs are refused, never run on the
// main thread.
let worker = null, seq = 0; const pending = new Map();

function spawn() {
  worker = new Worker(new URL("./workers/compute.worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (e) => { const { id, progress, result, error } = e.data || {}; const p = pending.get(id); if (!p) return;
    if (progress) { p.onProgress && p.onProgress(progress); return; }
    pending.delete(id); clearTimeout(p.timer); error ? p.reject(new Error(error)) : p.resolve(result); };
  worker.onerror = (e) => { const err = new Error(`Compute worker failed: ${e.message || "script error"}`); pending.forEach((p) => { clearTimeout(p.timer); p.reject(err); }); pending.clear(); worker = null; };
}
export const workersAvailable = () => typeof Worker !== "undefined";
const families = new Map();

/** @param {string} type @param {any} payload @param {{ onProgress?: (p: any) => void, timeoutMs?: number, family?: string }} [o] */
export function runJob(type, payload, { onProgress, timeoutMs = 10 * 60 * 1000, family = type } = {}) {
  if (!workersAvailable()) return { id: null, promise: Promise.reject(new Error("This browser does not support Web Workers, so heavy computations are disabled (they would freeze the page).")), cancel() {} };
  if (!worker) spawn();
  const prev = families.get(family); if (prev) prev.cancel("superseded");
  const id = ++seq; let cancelReason = null;
  const promise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cancelReason = "timeout"; worker && worker.postMessage({ type: "cancel", id });
      setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error(`Stopped after the ${Math.round(timeoutMs / 1000)} s time limit.`)); worker && worker.terminate(); worker = null; } }, 3000); }, timeoutMs);
    pending.set(id, { resolve, reject, onProgress, timer });
  });
  worker.postMessage({ id, type, payload });
  const h = { id, promise, cancel(reason = "cancelled by the user") { cancelReason = reason; if (worker && pending.has(id)) worker.postMessage({ type: "cancel", id }); }, get cancelReason() { return cancelReason; } };
  families.set(family, h); promise.finally(() => { if (families.get(family) === h) families.delete(family); }).catch(() => {});
  return h;
}
