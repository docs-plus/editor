/**
 * Shared env var parsers for test configuration.
 * Uses ?? semantics: undefined/empty → default; "0" → 0.
 * Industry pattern: trim, validate, fallback (like k6 K6_*, BENCHMARK_*).
 */

export function parseEnvNumber(
  env: string | undefined,
  defaultValue: number,
): number {
  const v = env?.trim();
  if (v === undefined || v === "") return defaultValue;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? defaultValue : n;
}

export function parseEnvFloat(
  env: string | undefined,
  defaultValue: number,
): number {
  const v = env?.trim();
  if (v === undefined || v === "") return defaultValue;
  const n = Number.parseFloat(v);
  return Number.isNaN(n) ? defaultValue : n;
}
