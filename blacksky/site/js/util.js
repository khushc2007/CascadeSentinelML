export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const pc = (x, d = 1) => (x == null || Number.isNaN(x) ? "–" : `${(100 * x).toFixed(d)}%`);
export const int = (n) => (n == null ? "–" : Number(n).toLocaleString("en-US"));
export const RM = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const GRID_NAME = { ieee14: "IEEE 14-bus", ieee30: "IEEE 30-bus", ieee118: "IEEE 118-bus" };
export const ENGINE_NAME = { "browser-dc": "Browser DC engine", "stored-dc": "Stored DC run", "stored-ac": "Stored AC run", "api-dc": "API DC engine", "api-ac": "API AC engine" };
export const rankText = (r) => (!r ? "not ranked" : r.zero ? `no demand lost (tied with ${int(r.tiedZero)} sets)` : `${r.exact ? "#" : "≈ #"}${int(r.rank)} of ${int(r.N)}`);
let toastT = 0;
export function toast(msg, ms = 3200) { const t = $("toast"); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => (t.hidden = true), ms); }
export const storage = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};
