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
