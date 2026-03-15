/**
 * Shared env var parsers for test configuration.
 * Uses ?? semantics: undefined/empty → default; "0" → 0.
 * Rejects negative values (counts/durations) → fallback to default.
 * Industry pattern: trim, validate, fallback (like k6 K6_*, BENCHMARK_*).
 */

export function parseEnvNumber(
  env: string | undefined,
  defaultValue: number,
): number {
  const v = env?.trim();
  if (v === undefined || v === "") return defaultValue;
  const n = Number.parseInt(v, 10);
  if (Number.isNaN(n) || n < 0) return defaultValue;
  return n;
}

export function parseEnvFloat(
  env: string | undefined,
  defaultValue: number,
): number {
  const v = env?.trim();
  if (v === undefined || v === "") return defaultValue;
  const n = Number.parseFloat(v);
  if (Number.isNaN(n) || n < 0) return defaultValue;
  return n;
}
