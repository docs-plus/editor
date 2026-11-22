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
  maxKeys?: number;
};

const ONE_MINUTE_MS = 60_000;
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
  const windows = createTimestampWindows(
    options.windowMs ?? ONE_MINUTE_MS,
    now,
    options.maxKeys ?? RATE_LIMIT_MAX_KEYS,
  );
  const overLimit = (key: string, limit: number) => {
    const recent = windows.recent(key);
    // A full key table fails closed, like every other limiter here.
    return !recent || recent.length >= limit;
  };
  const shareKey = (shareId: string) => `share:${shareId}`;

  return {
    isAddressBlocked(ip) {
      return addressKeys(ip).some((key) => overLimit(key, options.perPrefix));
    },
    isShareBlocked(shareId) {
      return overLimit(shareKey(shareId), options.perShare);
    },
    recordFailure(shareId, ip) {
      const at = now();
      for (const key of [shareKey(shareId), ...addressKeys(ip)]) {
        windows.recent(key)?.push(at);
      }
    },
  };
}
