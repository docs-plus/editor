function parseEnvInt(
  value: string | undefined,
  fallback: number,
  min: number,
): number {
  const raw = value?.trim();
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed < min) return fallback;
  return parsed;
}

function parseEnvString(value: string | undefined, fallback: string): string {
  const raw = value?.trim();
  return raw && raw.length > 0 ? raw : fallback;
}

export const HTTP_MUTATION_RATE_LIMIT_PER_MINUTE = parseEnvInt(
  process.env.HTTP_MUTATION_RATE_LIMIT,
  30,
  1,
);

export const WS_CONNECTION_LIMIT_PER_IP = parseEnvInt(
  process.env.WS_CONNECTION_LIMIT,
  10,
  1,
);

export const DOC_CREATION_RATE_LIMIT_PER_HOUR = parseEnvInt(
  process.env.DOC_CREATION_RATE_LIMIT,
  10,
  1,
);

export const MAX_TOTAL_DOCUMENTS = parseEnvInt(
  process.env.MAX_TOTAL_DOCUMENTS,
  2000,
  1,
);

export const MAX_DOC_SIZE_BYTES = parseEnvInt(
  process.env.MAX_DOC_SIZE_BYTES,
  1_048_576,
  1,
);

/** Store cap for the shared `playground` document (default 4 MiB). */
export const MAX_PLAYGROUND_DOC_SIZE_BYTES = parseEnvInt(
  process.env.MAX_PLAYGROUND_DOC_SIZE_BYTES,
  4_194_304,
  1,
);

/** Store cap for tab-list documents (`global-tabs`), default 256 KiB. */
export const MAX_TABS_DOC_SIZE_BYTES = parseEnvInt(
  process.env.MAX_TABS_DOC_SIZE_BYTES,
  262_144,
  1,
);

export const RETENTION_DAYS = parseEnvInt(process.env.RETENTION_DAYS, 30, 1);

/**
 * `1` lets clients open per-test `global-tabs-<id>` documents (Playwright
 * isolation). Dev and test only: never set it in production.
 */
export const HOCUS_ALLOW_ISOLATED_TABS_DOCS =
  process.env.HOCUS_ALLOW_ISOLATED_TABS_DOCS?.trim() === "1";

/** Largest WebSocket frame Hocuspocus accepts (default 2 MiB); bigger closes with 1009. */
export const HOCUS_MAX_PAYLOAD_BYTES = parseEnvInt(
  process.env.HOCUS_MAX_PAYLOAD_BYTES,
  2_097_152,
  1024,
);

/** Outbound buffer per socket before a slow reader is disconnected (default 8 MiB). */
export const HOCUS_BACKPRESSURE_LIMIT_BYTES = parseEnvInt(
  process.env.HOCUS_BACKPRESSURE_LIMIT_BYTES,
  8_388_608,
  65_536,
);

/** Largest awareness (presence) state relayed per client (default 4 KiB). */
export const MAX_AWARENESS_STATE_BYTES = parseEnvInt(
  process.env.MAX_AWARENESS_STATE_BYTES,
  4096,
  256,
);

/** Open WebSockets per IP, counted at upgrade before any auth (default 3x `WS_CONNECTION_LIMIT`). */
export const WS_SOCKETS_PER_IP = parseEnvInt(
  process.env.WS_SOCKETS_PER_IP,
  WS_CONNECTION_LIMIT_PER_IP * 3,
  1,
);

/** Open WebSockets across all clients (default 5000). */
export const MAX_WS_SOCKETS = parseEnvInt(process.env.MAX_WS_SOCKETS, 5000, 1);

/** WebSocket upgrades per IP per minute (default 60). */
export const WS_UPGRADE_RATE_LIMIT_PER_MINUTE = parseEnvInt(
  process.env.WS_UPGRADE_RATE_LIMIT,
  60,
  1,
);

/** A socket that sends nothing within this window is closed (default 10 s). */
export const HOCUS_AUTH_TIMEOUT_MS = parseEnvInt(
  process.env.HOCUS_AUTH_TIMEOUT_MS,
  10_000,
  1000,
);

/**
 * Comma-separated browser origins allowed to open WebSockets, e.g.
 * `https://tiny.docs.plus`. Empty (default) allows any origin. Requests
 * without an `Origin` header (scripts, load tests) are always allowed.
 */
export const HOCUS_ALLOWED_ORIGINS = (process.env.HOCUS_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

/** Interface Hocuspocus binds to (default all interfaces). */
export const HOCUS_HOST = parseEnvString(process.env.HOCUS_HOST, "0.0.0.0");

/** Distinct keys an in-memory rate limiter tracks before failing closed (default 50k). */
export const RATE_LIMIT_MAX_KEYS = parseEnvInt(
  process.env.RATE_LIMIT_MAX_KEYS,
  50_000,
  100,
);

/**
 * `1` only when every request arrives through one reverse proxy that appends the
 * client address to `X-Forwarded-For` (default: off). Off, those headers and
 * `X-Real-IP` are ignored: WS uses the socket address, HTTP the shared `unknown` key.
 */
export const TRUSTED_PROXY = process.env.TRUSTED_PROXY?.trim() === "1";

/** `0` disables `@hocuspocus/extension-logger` (default: on). */
export const HOCUS_LOGGER_ENABLED = process.env.HOCUS_LOGGER?.trim() !== "0";

/**
 * `0` disables `@hocuspocus/extension-throttle` (default: on).
 * Throttle counts connection attempts per IP per window (not the same as concurrent `WS_CONNECTION_LIMIT`).
 */
export const HOCUS_THROTTLE_ENABLED =
  process.env.HOCUS_THROTTLE?.trim() !== "0";

/** Max connection attempts per IP within `HOCUS_THROTTLE_WINDOW_SECONDS` before ban. */
export const HOCUS_THROTTLE_MAX_ATTEMPTS = parseEnvInt(
  process.env.HOCUS_THROTTLE_MAX_ATTEMPTS,
  15,
  1,
);

/** Ban duration after threshold exceeded (minutes). */
export const HOCUS_THROTTLE_BAN_MINUTES = parseEnvInt(
  process.env.HOCUS_THROTTLE_BAN_MINUTES,
  5,
  1,
);

/** Rolling window for connection-attempt counting (seconds). */
export const HOCUS_THROTTLE_WINDOW_SECONDS = parseEnvInt(
  process.env.HOCUS_THROTTLE_WINDOW_SECONDS,
  60,
  10,
);

/** `1` enables `@hocuspocus/extension-redis` for multi-instance pub/sub. */
export const HOCUS_REDIS_ENABLED = process.env.HOCUS_REDIS?.trim() === "1";

/** Redis host used by Hocuspocus Redis extension. */
export const HOCUS_REDIS_HOST = parseEnvString(
  process.env.HOCUS_REDIS_HOST,
  "127.0.0.1",
);

/** Redis port used by Hocuspocus Redis extension (non-default to avoid host conflicts). */
export const HOCUS_REDIS_PORT = parseEnvInt(
  process.env.HOCUS_REDIS_PORT,
  6380,
  1,
);

export function parseClientMaxTabsFromEnv(
  env: string | undefined = process.env.NEXT_PUBLIC_MAX_TABS_PER_CLIENT,
): number {
  return parseEnvInt(env, 50, 1);
}
