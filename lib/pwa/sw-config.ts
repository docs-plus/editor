/**
 * Shared by the service worker and the page. Never read process.env here:
 * Turbopack bundles the worker where `process` does not resolve, and
 * `next build` fails.
 */
export const CACHE_PREFIX = "tinydocy-";

/** Bump only when the stored-copy format or SHELL_PATHS semantics change. */
export const SHELL_CACHE = `${CACHE_PREFIX}shell-v1`;

/**
 * Content-addressed /_next/static files. Stable across versions so tabs
 * opened before a deploy keep loading their lazy chunks.
 */
export const STATIC_CACHE = `${CACHE_PREFIX}static`;

export const OFFLINE_URL = "/offline";

/** Pages whose last good copy is served when the network fails. */
export const SHELL_PATHS = ["/", "/about", "/privacy"] as const;

export const NAVIGATION_TIMEOUT_MS = 3_000;
export const STATIC_CACHE_MAX_ENTRIES = 300;
