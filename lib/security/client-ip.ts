import type { IncomingHttpHeaders } from "node:http";
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

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value.join(",") : value;
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
  return ip;
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
  headers: IncomingHttpHeaders,
  peerAddress: string | undefined,
  options: ClientIpOptions = {},
): string {
  const ip = resolveClientIp(
    {
      forwardedFor: headerValue(headers[FORWARDED_FOR]),
      realIp: headerValue(headers[REAL_IP]),
      peerAddress,
    },
    options,
  );
  delete headers[FORWARDED_FOR];
  headers[REAL_IP] = ip;
  return ip;
}

/** Client IP pinned by `pinClientIp` during the WebSocket upgrade. */
export function getPinnedClientIp(headers: IncomingHttpHeaders): string {
  return headerValue(headers[REAL_IP]) || UNKNOWN_CLIENT_IP;
}
