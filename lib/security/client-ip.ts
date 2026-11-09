import { isIP } from "node:net";

import { TRUSTED_PROXY } from "@/lib/security/guardrail-config";

/** Shared guardrail bucket for requests without a trustworthy client address. */
export const UNKNOWN_CLIENT_IP = "unknown";

const FORWARDED_FOR = "x-forwarded-for";
const REAL_IP = "x-real-ip";

const PRIVATE_IP_RANGES = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[0-1])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe80:/i,
];

const IPV4_MAPPED_PREFIX = /^::ffff:(?=\d{1,3}(\.\d{1,3}){3}$)/i;

type ClientIpOptions = { trustedProxy?: boolean; nodeEnv?: string };

type AddressSources = {
  forwardedFor?: string | null;
  realIp?: string | null;
  peerAddress?: string | null;
};

function isPrivateOrReservedIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((pattern) => pattern.test(ip));
}

/** Rightmost entry: the address the trusted proxy itself appended. Entries to its left are client-supplied. */
function lastForwardedIp(value: string | null | undefined): string | undefined {
  return value
    ?.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .at(-1);
}

/** Expands an IPv6 address to its eight 16-bit groups, or null if malformed. */
function expandIpv6(ip: string): string[] | null {
  const halves = ip.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  return [...head, ...Array<string>(missing).fill("0"), ...tail];
}

/**
 * One key per IPv6 /64: a single host usually controls a whole /64, so
 * per-address limits would let it rotate through 2^64 addresses.
 */
export function toIpv6Prefix64(ip: string): string {
  const groups = expandIpv6(ip);
  if (!groups) return ip;
  const prefix = groups
    .slice(0, 4)
    .map((group) => Number.parseInt(group || "0", 16).toString(16))
    .join(":");
  return `${prefix}::/64`;
}

/**
 * Forwarding headers count only behind a trusted proxy; otherwise any client
 * could rotate them to dodge per-IP limits, so only the TCP peer address is used.
 */
function resolveClientIp(
  { forwardedFor, realIp, peerAddress }: AddressSources,
  options: ClientIpOptions,
): string {
  const trustedProxy = options.trustedProxy ?? TRUSTED_PROXY;
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";

  const candidate = trustedProxy
    ? lastForwardedIp(forwardedFor) || realIp?.trim() || peerAddress
    : peerAddress;
  const ip = candidate?.replace(IPV4_MAPPED_PREFIX, "");

  if (!ip || isIP(ip) === 0) return UNKNOWN_CLIENT_IP;
  if (nodeEnv !== "development" && isPrivateOrReservedIp(ip)) {
    return UNKNOWN_CLIENT_IP;
  }
  return isIP(ip) === 6 ? toIpv6Prefix64(ip) : ip;
}

/**
 * Client IP for HTTP handlers, which see headers but no socket. Without
 * `TRUSTED_PROXY=1` the headers are client-controlled, so every request falls
 * into the shared `unknown` bucket (fail closed) instead of a spoofable one.
 */
export function getClientIpFromHeaders(
  headers: Headers,
  options: ClientIpOptions = {},
): string {
  return resolveClientIp(
    {
      forwardedFor: headers.get(FORWARDED_FOR),
      realIp: headers.get(REAL_IP),
    },
    options,
  );
}

/**
 * WebSocket trust boundary: resolves the client IP once at upgrade and
 * rewrites the request headers so `x-real-ip` holds it and `x-forwarded-for`
 * is gone. Every later reader (our guardrails via `getPinnedClientIp`, and
 * `@hocuspocus/extension-throttle`, which reads `x-real-ip` then
 * `x-forwarded-for`) then keys on the same value, and client-supplied headers
 * never reach them. Mutates `headers` in place.
 */
export function pinClientIp(
  headers: Headers,
  peerAddress: string | undefined,
  options: ClientIpOptions = {},
): string {
  const ip = resolveClientIp(
    {
      forwardedFor: headers.get(FORWARDED_FOR),
      realIp: headers.get(REAL_IP),
      peerAddress,
    },
    options,
  );
  headers.delete(FORWARDED_FOR);
  headers.set(REAL_IP, ip);
  return ip;
}

/** Client IP pinned by `pinClientIp` during the WebSocket upgrade. */
export function getPinnedClientIp(headers: Headers): string {
  return headers.get(REAL_IP) || UNKNOWN_CLIENT_IP;
}
