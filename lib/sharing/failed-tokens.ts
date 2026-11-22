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
 * Checks only read: a key is added when a failure is recorded, so a flood
 * of checks (random share ids, say) cannot fill the table. Share keys live
 * in their own smaller table. A full table drops new keys, which fails
 * open: the other limits (upgrade rate, HTTP rate, sockets) still bound
 * the load, and failing closed would make every share answer `busy`.
 */
export type FailedTokenLimiter = {
  /** True when this address (IPv4, IPv6 /64 or its /48) is over its limit. */
  isAddressBlocked(ip: string): boolean;
  /** True when this share had too many wrong tokens; asked only after a miss. */
  isShareBlocked(shareId: string): boolean;
  recordFailure(shareId: string, ip: string): void;
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

export function createFailedTokenLimiter(
  options: FailedTokenLimiterOptions,
): FailedTokenLimiter {
  const now = options.now ?? Date.now;
  const windowMs = options.windowMs ?? ONE_MINUTE_MS;
  const addresses = createTimestampWindows(
    windowMs,
    now,
    options.maxKeys ?? RATE_LIMIT_MAX_KEYS,
  );
  const shares = createTimestampWindows(
    windowMs,
    now,
    options.maxShareKeys ?? MAX_SHARE_KEYS,
  );

  return {
    isAddressBlocked(ip) {
      // The /48 first: a blocked /48 never needs its /64 looked at.
      return addressKeys(ip)
        .reverse()
        .some((key) => addresses.peek(key) >= options.perPrefix);
    },
    isShareBlocked(shareId) {
      return shares.peek(shareId) >= options.perShare;
    },
    recordFailure(shareId, ip) {
      const at = now();
      shares.recent(shareId)?.push(at);
      for (const key of addressKeys(ip)) addresses.recent(key)?.push(at);
    },
  };
}
