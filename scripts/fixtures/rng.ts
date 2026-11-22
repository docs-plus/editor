/**
 * The seeded PRNG every fixture generator draws from (test strategy §3.1:
 * generated, seeded, reproducible). Mulberry32: tiny, fast and good enough
 * for test data; never for anything secret.
 */

export type Rng = {
  readonly seed: number;
  /** A number in [0, 1), like `Math.random`. */
  next(): number;
  /** An integer in [min, max], both inclusive. */
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** `bytes` random bytes as lowercase hex. */
  hex(bytes: number): string;
  /** A version-4-shaped UUID, so ids pass the engine's UUID guards. */
  uuid(): string;
  /** An independent stream, so one part's draws never shift another's. */
  fork(label: string): Rng;
};

/** Parses `--seed` / `SEED`: an integer in [0, 2^32). */
export function parseSeed(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff)
    throw new Error(`seed must be an integer in [0, 2^32): ${raw}`);
  return value;
}

function hashLabel(seed: number, label: string): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < label.length; i++)
    h = Math.imul(h ^ label.charCodeAt(i), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const hex = (bytes: number) => {
    let out = "";
    for (let i = 0; i < bytes; i++)
      out += Math.floor(next() * 256)
        .toString(16)
        .padStart(2, "0");
    return out;
  };
  return {
    seed,
    next,
    int: (min, max) => Math.floor(next() * (max - min + 1)) + min,
    pick: (items) => items[Math.floor(next() * items.length)],
    hex,
    uuid() {
      const h = hex(16);
      const variant = "89ab"[Number.parseInt(h[16], 16) & 3];
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20)}`;
    },
    fork: (label) => createRng(hashLabel(seed, label)),
  };
}
