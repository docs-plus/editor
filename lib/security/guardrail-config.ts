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

export const RETENTION_DAYS = parseEnvInt(process.env.RETENTION_DAYS, 30, 1);

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
