import { RATE_LIMIT_MAX_KEYS } from "@/lib/security/guardrail-config";
import { createTimestampWindows } from "@/lib/security/rate-limit";

/**
 * Failed share tokens, counted per `share_id` and per client address
 * (plan §6 "Failed tokens"). Guessing a 128-bit secret is pointless, so
 * this protects the server, not the secret: past a limit, attempts are
 * refused before any lookup. IPs arrive pinned (`pinClientIp`): IPv6 is
 * already one key per /64, and each /64 also counts toward its /48.
 */
export type FailedTokenLimiter = {
  /** True when this share or this address is over its limit. */
  isBlocked(shareId: string, ip: string): boolean;
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
  const limits = (shareId: string, ip: string): Array<[string, number]> => [
    [`share:${shareId}`, options.perShare],
    ...addressKeys(ip).map((key): [string, number] => [key, options.perPrefix]),
  ];

  return {
    isBlocked(shareId, ip) {
      return limits(shareId, ip).some(([key, limit]) => {
        const recent = windows.recent(key);
        // A full key table fails closed, like every other limiter here.
        return !recent || recent.length >= limit;
      });
    },
    recordFailure(shareId, ip) {
      const at = now();
      for (const [key] of limits(shareId, ip)) windows.recent(key)?.push(at);
    },
  };
}
