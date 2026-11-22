/**
 * The stored update origins, mirrored from `UPDATE_ORIGINS` in
 * `lib/platform/doc-store.ts` (this folder imports nothing outside itself;
 * a unit test keeps the two lists equal).
 */
export const UPDATE_ORIGINS_MIRROR = [
  "local",
  "migration",
  "remote",
  "restore",
] as const;

/**
 * The origins a renderer may append (SEC-011). `local-session` produces
 * exactly these: `"local"` for edits and `"migration"` for the open hook's
 * forward migrations, which run in the renderer before the editor binds
 * (architecture §5.1). `"restore"` is written by main and the worker only,
 * on closed documents; `"remote"` joins this list with Live, when the
 * renderer's provider starts appending server updates.
 */
export const RENDERER_ORIGINS = ["local", "migration"] as const;
