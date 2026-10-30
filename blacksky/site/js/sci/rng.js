// @ts-check
// Seeded pseudo-random numbers for every randomised method in BLACKSKY (search, splits, sampling, shots). xoshiro128** seeded through
// splitmix32, so a recorded integer seed reproduces a run exactly on any JavaScript engine. Not cryptographic.

/** @param {number} seed */
function splitmix32(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x9e3779b9) >>> 0; let z = s; z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0; z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0; return (z ^ (z >>> 16)) >>> 0; };
}

/**
 * @typedef {{ seed: number, next: () => number, int: (n: number) => number, pick: <T>(a: T[]) => T, shuffle: <T>(a: T[]) => T[], normal: () => number, fork: (k: number) => Rng }} Rng
 */

/** @param {number} seed integer seed (recorded with every experiment) @returns {Rng} */
export function makeRng(seed) {
  if (!Number.isFinite(seed)) throw new Error(`seed must be a finite number (got ${seed})`);
  const sm = splitmix32(Math.floor(seed)); let a = sm(), b = sm(), c = sm(), d = sm();
  if ((a | b | c | d) === 0) a = 1;
  const u32 = () => {
    const r = Math.imul(rotl(Math.imul(b, 5), 7), 9) >>> 0, t = (b << 9) >>> 0;
    c ^= a; d ^= b; b ^= c; a ^= d; c ^= t; d = rotl(d, 11); return r;
  };
  /** @type {Rng} */
  const rng = {
    seed: Math.floor(seed),
    next: () => u32() / 4294967296,                                   // uniform [0, 1)
    int: (n) => { if (!(n >= 1)) throw new Error("int(n) needs n >= 1"); const lim = Math.floor(4294967296 / n) * n; let x; do x = u32(); while (x >= lim); return x % n; },
    pick: (arr) => arr[rng.int(arr.length)],
    shuffle: (arr) => { for (let i = arr.length - 1; i > 0; i--) { const j = rng.int(i + 1); const t = arr[i]; arr[i] = arr[j]; arr[j] = t; } return arr; },
    normal: () => { let u = 0; while (u === 0) u = rng.next(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next()); },
    fork: (k) => makeRng((Math.floor(seed) * 1000003 + k * 7919 + 17) >>> 0),
  };
  return rng;
}
/** @param {number} x @param {number} k */
function rotl(x, k) { return ((x << k) | (x >>> (32 - k))) >>> 0; }
