import { CLIENT_SCHEMA } from "@/lib/schema-version";
import { TABS_DOC } from "@/lib/security/doc-id-validator";
import {
  HOCUS_MESSAGE_AUTH,
  readFrameHeader,
} from "@/lib/security/hocus-frame";

/** Refusal reason for a bundle below the effective minimum client schema. */
export const CLIENT_OUTDATED_REASON = "client_outdated";

/**
 * Lowest client schema Hocus ever admits to gated documents (spec §3.1, B3).
 * Bundles below it delete content they do not know, so the gate is never
 * log-only again. It only ever goes up; never lower it, not even to roll back.
 */
export const SCHEMA_FLOOR = 2;

/**
 * The minimum the gate enforces: `HOCUS_MIN_CLIENT_SCHEMA` can raise the
 * floor, never lower it.
 */
export function effectiveMinClientSchema(envMin: number): number {
  return Math.max(envMin, SCHEMA_FLOOR);
}

export type ClientSchemaBucket = "missing" | "invalid" | "low" | "ok";

const SCHEMA_PATTERN = /^\d+$/;
const BUILD_PATTERN = /^[A-Za-z0-9._-]{1,40}$/;

/**
 * True when a socket's `schema` parameter is below `minSchema`. At 0 (log
 * only) nothing is refused. Otherwise anything but a plain decimal integer
 * ≥ min is refused; a missing value counts as 0.
 */
export function isClientOutdated(
  raw: string | null,
  minSchema: number,
): boolean {
  if (minSchema <= 0) return false;
  if (raw === null) return true;
  return !SCHEMA_PATTERN.test(raw) || Number(raw) < minSchema;
}

/** Log bucket for a `schema` value, relative to the current `CLIENT_SCHEMA`. */
export function classifyClientSchema(raw: string | null): ClientSchemaBucket {
  if (raw === null) return "missing";
  if (!SCHEMA_PATTERN.test(raw)) return "invalid";
  return Number(raw) < CLIENT_SCHEMA ? "low" : "ok";
}

/**
 * Tab lists (`global-tabs`, `global-tabs-*`) stay open to outdated clients so
 * they can still list documents and show the update banner.
 */
export function isGateExempt(documentName: string): boolean {
  return documentName === TABS_DOC || documentName.startsWith(`${TABS_DOC}-`);
}

/**
 * The `onConnect` refusal for an outdated client. Not an abuse event: it is
 * logged only in the per-minute aggregate, and carries no stack trace.
 */
export function clientOutdatedError(): Error & { reason: string } {
  const error = Object.assign(new Error(CLIENT_OUTDATED_REASON), {
    reason: CLIENT_OUTDATED_REASON,
  });
  error.stack = "";
  return error;
}

/**
 * For a socket already judged outdated: true when a frame must not reach
 * Hocuspocus. Auth frames pass (each gets its `client_outdated` refusal), and
 * so does everything for exempt documents. The rest would only queue toward
 * Hocuspocus's 1,000-frame unauthenticated limit and reset the socket, which
 * would drop the tab list too. Frames that do not decode are dropped.
 */
export function shouldDropOutdatedFrame(frame: Uint8Array): boolean {
  const header = readFrameHeader(frame);
  if (!header) return true;
  if (header.messageType === HOCUS_MESSAGE_AUTH) return false;
  return !isGateExempt(header.documentName);
}

type ClientSchemaCounterOptions = {
  intervalMs?: number;
  /** Distinct build ids logged per window; the rest count as `other`. */
  maxBuilds?: number;
  log?: (line: string) => void;
};

function buildKey(raw: string | null): string {
  if (raw === null) return "missing";
  return BUILD_PATTERN.test(raw) ? raw : "invalid";
}

/**
 * Aggregates gated connection attempts into one JSON line per window:
 * fixed `schema` buckets, refusals, and per-build counts. Raw `schema`
 * values are never logged; builds outside a strict pattern are `invalid`.
 */
export function createClientSchemaCounter({
  intervalMs = 60_000,
  maxBuilds = 20,
  log = console.log,
}: ClientSchemaCounterOptions = {}) {
  const emptyCounts = () => ({
    missing: 0,
    invalid: 0,
    low: 0,
    ok: 0,
    refused: 0,
  });
  let windowStart = new Date();
  let counts = emptyCounts();
  let builds = new Map<string, number>();
  let distinctBuilds = 0;

  function countBuild(raw: string | null): void {
    let key = buildKey(raw);
    if (key === raw && !builds.has(key)) {
      if (distinctBuilds >= maxBuilds) key = "other";
      else distinctBuilds += 1;
    }
    builds.set(key, (builds.get(key) ?? 0) + 1);
  }

  function flush(): void {
    const total = counts.missing + counts.invalid + counts.low + counts.ok;
    if (total > 0) {
      log(
        JSON.stringify({
          type: "hocus",
          event: "client_schema",
          window_start: windowStart.toISOString(),
          ...counts,
          builds: Object.fromEntries(builds),
        }),
      );
    }
    windowStart = new Date();
    counts = emptyCounts();
    builds = new Map();
    distinctBuilds = 0;
  }

  const timer = setInterval(flush, intervalMs);
  timer.unref();

  return {
    record(params: URLSearchParams, refused: boolean): void {
      counts[classifyClientSchema(params.get("schema"))] += 1;
      if (refused) counts.refused += 1;
      countBuild(params.get("build"));
    },
    flush,
    stop(): void {
      flush();
      clearInterval(timer);
    },
  };
}
