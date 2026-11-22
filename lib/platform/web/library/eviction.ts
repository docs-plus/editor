/**
 * Eviction detection (offline data-model revision §3.6; W6 shows it). The
 * browser may clear site data, and IndexedDB then comes back empty. Two
 * markers tell that apart from a library that never existed:
 * - `meta.eviction_sentinel`, the `library_id`, written once at creation
 *   (`library-schema.ts`, read at open as `LibraryDb.evictionSentinel`);
 * - a `localStorage` key carrying the same `library_id`.
 *
 * At boot, a marker whose library is gone or different means "Your local
 * copy was cleared by the browser". This only detects; `persist()` and the
 * document cap are the defences. The derived stores can be rebuilt, but
 * `docs`, `updates` and `snapshots` can't.
 *
 * `localStorage` can be missing or throw (private mode, blocked site data),
 * so every access is guarded; a failure reads as "no marker".
 */

/** The `localStorage` key that carries the library's `library_id`. */
export const EVICTION_MARKER_KEY = "tinydocy-library-id";

/** The part of `localStorage` the marker needs. */
export type MarkerStorage = Pick<Storage, "getItem" | "setItem">;

export function readEvictionMarker(
  storage: MarkerStorage | undefined,
): string | null {
  try {
    return storage?.getItem(EVICTION_MARKER_KEY) ?? null;
  } catch {
    return null;
  }
}

/** Records `libraryId` outside IndexedDB. Returns false when it couldn't. */
export function writeEvictionMarker(
  storage: MarkerStorage | undefined,
  libraryId: string,
): boolean {
  try {
    if (!storage) return false;
    storage.setItem(EVICTION_MARKER_KEY, libraryId);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when a library this browser held is gone: the marker names a
 * library, and the database has no sentinel (empty, or created afresh)
 * or a different one.
 */
export function libraryWasCleared(
  marker: string | null,
  sentinel: string | null,
): boolean {
  return marker !== null && marker !== sentinel;
}
