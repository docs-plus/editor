import { logAbuseEvent } from "@/lib/security/abuse-log";
import { RATE_LIMIT_MAX_KEYS } from "@/lib/security/guardrail-config";

/**
 * Failed share tokens, counted per `share_id` and per client address
 * (plan §6 "Failed tokens"). Guessing a 128-bit secret is pointless, so
 * this protects the server, not the secret. An address over its limit is
 * refused before any lookup; a share over its limit refuses its edit and
 * view tokens, never its owner secret (`authenticateShare`). IPs arrive
 * pinned (`pinClientIp`): IPv6 is already one key per /64, and each /64
 * also counts toward its /48.
 *
 * Keys are added only when a failure is recorded, never by a check, and a
 * share key only for a share that exists. Each table is an LRU: a full
 * table evicts its least recently used key, so it never refuses an
 * address it has not seen (failing closed would let a flood deny
 * everyone) and never stops counting (failing open would). Every check
 * and failure touches the /48 key, so a flood rotating through the /64s
 * of one /48 keeps that /48 resident and blocked. Evictions under
 * pressure log `share_failed_token_table_evicting` once per window.
 */
export type FailedTokenLimiter = {
  /** True when this address (IPv4, IPv6 /64 or its /48) is over its limit. */
  isAddressBlocked(ip: string): boolean;
  /** True when this share had too many wrong tokens. */
  isShareBlocked(shareId: string): boolean;
  /** Counts a failure for `ip`, and for `shareId` when that share exists. */
  recordFailure(ip: string, shareId?: string): void;
};

type FailedTokenLimiterOptions = {
  perShare: number;
  perPrefix: number;
  windowMs?: number;
  now?: () => number;
  /** Address keys tracked; `RATE_LIMIT_MAX_KEYS` by default. */
  maxKeys?: number;
  /** Share keys tracked, in a table of their own. */
  maxShareKeys?: number;
};

const ONE_MINUTE_MS = 60_000;
const MAX_SHARE_KEYS = 10_000;
const IPV6_PREFIX_64 =
  /^([0-9a-f]{1,4}:[0-9a-f]{1,4}:[0-9a-f]{1,4}):[0-9a-f]{1,4}::\/64$/i;

/** Address keys for `ip`: itself (IPv4 or /64), plus the /48 for IPv6. */
export function addressKeys(ip: string): string[] {
  const match = IPV6_PREFIX_64.exec(ip);
  if (!match) return [`ip:${ip}`];
  return [`ip:${ip}`, `p48:${match[1]}::/48`];
}

/** Failure timestamps per key, at most `maxKeys` keys, least recently used evicted. */
function createFailureTable(
  table: string,
  maxKeys: number,
  windowMs: number,
  now: () => number,
) {
  // A Map iterates in insertion order: re-inserting a key marks it used.
  const entries = new Map<string, number[]>();
  let loggedAt = Number.NEGATIVE_INFINITY;

  /** Recent timestamps for `key`, marked most recently used; null when absent. */
  function touch(key: string, at: number): number[] | null {
    const timestamps = entries.get(key);
    if (!timestamps) return null;
    const recent = timestamps.filter((t) => t > at - windowMs);
    entries.delete(key);
    if (recent.length > 0) entries.set(key, recent);
    return recent;
  }

  function evictOldest(at: number): void {
    const oldest = entries.keys().next();
    if (oldest.done) return;
    entries.delete(oldest.value);
    if (at - loggedAt < windowMs) return;
    loggedAt = at;
    logAbuseEvent("share_failed_token_table_evicting", {
      table,
      max_keys: maxKeys,
    });
  }

  return {
    count(key: string): number {
      return touch(key, now())?.length ?? 0;
    },
    record(key: string, at: number): void {
      const recent = touch(key, at) ?? [];
      if (!entries.has(key) && entries.size >= maxKeys) evictOldest(at);
      recent.push(at);
      entries.set(key, recent);
    },
  };
}

export function createFailedTokenLimiter(
  options: FailedTokenLimiterOptions,
): FailedTokenLimiter {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? ONE_MINUTE_MS;
  const addresses = createFailureTable(
    "addresses",
    options.maxKeys ?? RATE_LIMIT_MAX_KEYS,
    windowMs,
    now,
  );
  const shares = createFailureTable(
    "shares",
    options.maxShareKeys ?? MAX_SHARE_KEYS,
    windowMs,
    now,
  );

  return {
    isAddressBlocked(ip) {
      // Every key is looked at (and touched), the /48 included.
      return addressKeys(ip)
        .map((key) => addresses.count(key))
        .some((count) => count >= options.perPrefix);
    },
    isShareBlocked(shareId) {
      return shares.count(shareId) >= options.perShare;
    },
    recordFailure(ip, shareId) {
      const at = now();
      if (shareId) shares.record(shareId, at);
      for (const key of addressKeys(ip)) addresses.record(key, at);
    },
  };
}
