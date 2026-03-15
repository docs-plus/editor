/**
 * Shared configuration for soak tests.
 * Env vars: SOAK_DURATION, SOAK_HEADINGS, SOAK_USERS, SOAK_WARMUP, SOAK_MEMORY_GROWTH_LIMIT.
 * Use Makefile as CLI: make test-soak SOAK_DURATION=300000 SOAK_HEADINGS=100
 */

import { parseEnvNumber } from "./env-parsers";

export function parseSoakDuration(env: string | undefined): number {
  return parseEnvNumber(env, 1_800_000);
}

export function parseSoakHeadings(env: string | undefined): number {
  return parseEnvNumber(env, 200);
}

export function parseSoakUsers(env: string | undefined): number {
  return parseEnvNumber(env, 3);
}

export function parseSoakWarmup(
  env: string | undefined,
  durationMs: number,
): number {
  const fallback = durationMs < 600_000 ? 30_000 : 120_000;
  return parseEnvNumber(env, fallback);
}

export function parseSoakMemoryGrowthLimit(env: string | undefined): number {
  return parseEnvNumber(env, 50);
}
