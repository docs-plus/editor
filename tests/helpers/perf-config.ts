/**
 * Shared configuration for performance tests.
 * Env vars: PERF_HEADINGS, PERF_SHAPE, PERF_COLLAB_USERS, PERF_COLLAB_HEADINGS, PERF_COLLAB_SHAPE.
 * Use Makefile as CLI: make test-perf PERF_HEADINGS=200 PERF_SHAPE=mixed
 */

import { parseEnvNumber } from "./env-parsers";

export const VALID_SHAPES = ["flat", "deep", "mixed"] as const;
export type PerfShape = (typeof VALID_SHAPES)[number];

export function parsePerfShape(env: string | undefined): PerfShape {
  const v = env?.trim();
  if (!v) return "flat";
  return VALID_SHAPES.includes(v as PerfShape) ? (v as PerfShape) : "flat";
}

export function parsePerfHeadings(
  env: string | undefined,
  defaultValue: number[],
): number[] {
  const v = env?.trim();
  if (!v) return defaultValue;
  const parsed = v.split(",").map((s) => Number.parseInt(s.trim(), 10));
  const valid = parsed.filter((n) => !Number.isNaN(n));
  return valid.length > 0 ? valid : defaultValue;
}

export const parsePerfNumber = parseEnvNumber;
