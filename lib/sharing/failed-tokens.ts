import { logAbuseEvent } from "@/lib/security/abuse-log";
import { RATE_LIMIT_MAX_KEYS } from "@/lib/security/guardrail-config";
import { createTimestampWindows } from "@/lib/security/rate-limit";

/**
 * Failed share tokens, counted per `share_id` and per client address
 * (plan §6 "Failed tokens"). Guessing a 128-bit secret is pointless, so
 * this protects the server, not the secret. An address over its limit is
 * refused before any lookup; a share over its limit refuses only wrong
 * tokens, so nobody can lock a token holder (or the owner) out of a share
 * by flooding it. IPs arrive pinned (`pinClientIp`): IPv6 is already one
 * key per /64, and each /64 also counts toward its /48.
 *
 * Keys are added only when a failure is recorded, never by a check, and a
 * share key only for a share that exists, so a flood of checks or of
 * random share ids cannot fill a table: one /48 adds at most `perPrefix`
 * /64 keys a minute before its /48 key blocks it. A full table fails
 * closed (an address or share it does not track counts as over its
 * limit) and logs `share_failed_token_table_full` once per window.
 */
export type FailedTokenLimiter = {
  /** True when this address (IPv4, IPv6 /64 or its /48) is over its limit. */
  isAddressBlocked(ip: string): boolean;
  /** True when this share had too many wrong tokens; asked only after a miss. */
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

/** One bounded table of failure timestamps that fails closed when full. */
function createFailureTable(
  table: string,
  maxKeys: number,
  windowMs: number,
  now: () => number,
) {
  const windows = createTimestampWindows(windowMs, now, maxKeys);
  let loggedAt = Number.NEGATIVE_INFINITY;

  function saturated(): void {
    const at = now();
    if (at - loggedAt < windowMs) return;
    loggedAt = at;
    logAbuseEvent("share_failed_token_table_full", {
      table,
      max_keys: maxKeys,
    });
  }

  return {
    /** Over `limit`, or untracked while the table is full. */
    blocked(key: string, limit: number): boolean {
      if (windows.peek(key) >= limit) return true;
      if (windows.has(key) || windows.size() < maxKeys) return false;
      saturated();
      return true;
    },
    record(key: string, at: number): void {
      const recent = windows.recent(key);
      if (recent) recent.push(at);
      else saturated();
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
      return addressKeys(ip).some((key) =>
        addresses.blocked(key, options.perPrefix),
      );
    },
    isShareBlocked(shareId) {
      return shares.blocked(shareId, options.perShare);
    },
    recordFailure(ip, shareId) {
      const at = now();
      if (shareId) shares.record(shareId, at);
      // The /48 first, so a nearly full table still counts the prefix.
      for (const key of addressKeys(ip).reverse()) addresses.record(key, at);
    },
  };
}
