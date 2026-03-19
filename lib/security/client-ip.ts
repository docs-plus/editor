import { TRUSTED_PROXY } from "@/lib/security/guardrail-config";

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

function isPrivateOrReservedIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((pattern) => pattern.test(ip));
}

function normalizeForwardedIp(value: string): string | null {
  const entries = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (entries.length === 0) return null;
  return entries[0] ?? null;
}

export function getClientIpFromHeaders(
  headers: Headers,
  options: { trustedProxy?: boolean; nodeEnv?: string } = {},
): string {
  const trustedProxy = options.trustedProxy ?? TRUSTED_PROXY;
  const nodeEnv = options.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const fromForwarded = headers.get("x-forwarded-for");
  const fromRealIp = headers.get("x-real-ip")?.trim() || null;

  let candidate = fromRealIp;
  if (trustedProxy && fromForwarded) {
    candidate = normalizeForwardedIp(fromForwarded);
  } else if (!candidate && fromForwarded) {
    candidate = normalizeForwardedIp(fromForwarded);
  }

  if (!candidate) return "unknown";
  if (nodeEnv !== "development" && isPrivateOrReservedIp(candidate)) {
    return "unknown";
  }
  return candidate;
}
