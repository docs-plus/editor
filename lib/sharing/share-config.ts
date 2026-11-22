import { parseEnvInt } from "@/lib/security/guardrail-config";

/**
 * Share server settings (plan §6, P4.2a–d). Everything here is read by the
 * Hocus process only. The feature ships dark: `HOCUS_SHARES` defaults to
 * `off`, and off means no `shares` table, no share endpoints (404) and
 * `share:*` names refused exactly as before.
 */
export type SharesMode = "on" | "readonly" | "off";

/** `on`, `readonly` or `off`; anything else (including unset) is `off`. */
export function parseSharesMode(raw: string | undefined): SharesMode {
  const value = raw?.trim().toLowerCase();
  return value === "on" || value === "readonly" ? value : "off";
}

/**
 * Kill switch reported in `/api/info.features.shares`. `readonly` keeps
 * existing shares readable (every connection read-only) and refuses new
 * shares and resets; owners can still stop sharing or make a share view-only.
 */
export const HOCUS_SHARES: SharesMode = parseSharesMode(
  process.env.HOCUS_SHARES,
);

/**
 * `on` serves `DELETE /api/documents/:id` from the Hocus process (P4.1).
 * Off by default: the Next.js route keeps serving it until the operator
 * moves the Traefik route (CHANGELOG Deploy note).
 */
export const HOCUS_DELETE_ROUTE =
  process.env.HOCUS_DELETE_ROUTE?.trim().toLowerCase() === "on";

/**
 * Lowest client schema a share connection or create may use: `CLIENT_SCHEMA`
 * 3 knows asset refs (plan §6 "Schema floor for shares"). Fixed from day one,
 * so it is a constant, not a setting.
 */
export const SHARE_SCHEMA_FLOOR = 3;

/** Live shares across the server, separate from `MAX_TOTAL_DOCUMENTS`. */
export const MAX_TOTAL_SHARES = parseEnvInt(
  process.env.MAX_TOTAL_SHARES,
  2000,
  1,
);

/** A share ends this many days after its last stored edit. */
export const SHARE_EXPIRY_DAYS = parseEnvInt(
  process.env.SHARE_EXPIRY_DAYS,
  30,
  1,
);

/** Days `created_ip_hash` is kept before it is cleared. */
export const SHARE_IP_HASH_RETENTION_DAYS = 30;

/** Shares (creates and resets) one IP may make per hour. */
export const SHARE_CREATION_RATE_LIMIT_PER_HOUR = parseEnvInt(
  process.env.SHARE_CREATION_RATE_LIMIT,
  10,
  1,
);

/** Shares the whole server may make per hour. */
export const SHARE_GLOBAL_CREATION_LIMIT_PER_HOUR = parseEnvInt(
  process.env.SHARE_GLOBAL_CREATION_LIMIT,
  200,
  1,
);

/** Failed tokens per share per minute before that share pauses as `busy`. */
export const SHARE_FAILED_TOKENS_PER_SHARE = parseEnvInt(
  process.env.SHARE_FAILED_TOKENS_PER_SHARE,
  30,
  1,
);

/** Failed tokens per client address (IPv4, IPv6 /64 and /48) per minute. */
export const SHARE_FAILED_TOKENS_PER_PREFIX = parseEnvInt(
  process.env.SHARE_FAILED_TOKENS_PER_PREFIX,
  10,
  1,
);

/**
 * Open share connections per IP; the next one is refused as `busy` (the
 * client pauses and retries), never banned. Counted apart from the
 * sandbox's `WS_CONNECTION_LIMIT`, so the two caps are independent.
 */
export const SHARE_WS_CONNECTIONS_PER_IP = parseEnvInt(
  process.env.SHARE_WS_CONNECTIONS_PER_IP,
  10,
  1,
);

/** Status and info reads per IP per minute. */
export const SHARE_READ_RATE_LIMIT_PER_MINUTE = parseEnvInt(
  process.env.SHARE_READ_RATE_LIMIT,
  120,
  1,
);

/**
 * Comma-separated origins allowed to call the share endpoints from a
 * browser (CORS): the desktop renderer and the web library. Requests
 * without an `Origin` header (desktop main's `net.fetch`) are allowed.
 */
export const HOCUS_SHARE_ORIGINS = (process.env.HOCUS_SHARE_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

/**
 * Key for `created_ip_hash` (HMAC-SHA-256). Unset, a random key per process
 * is used, so hashes then only match within one run.
 */
export const SHARE_IP_HASH_KEY = process.env.SHARE_IP_HASH_KEY?.trim() ?? "";
