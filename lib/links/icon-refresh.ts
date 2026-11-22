/**
 * Keeps link icons current as the library changes (search-linking §4.6).
 * The extension draws an icon once per link, so the host redraws them
 * (`LinkHostHandle.refreshIcons`) after index events, debounced, and only
 * when something an icon shows changed: a link key appearing or going, or
 * a document moving in or out of the Trash. Renames, moves, pins and
 * `openedAt` stamps change no icon and redraw nothing.
 */
import type { LinkIndexSnapshot } from "@/lib/links/resolve";

export interface IconRefresherOptions {
  /** `LibraryIndex.subscribe`; returns the unsubscribe function. */
  subscribe(listener: () => void): () => void;
  /** `LibraryIndex.snapshot`. */
  getSnapshot(): LinkIndexSnapshot;
  /** Redraws the icons, e.g. `() => handle.refreshIcons(view.dom)`. */
  refresh(): void;
  /** Quiet time after the last event before comparing. Default 100 ms. */
  delayMs?: number;
}

export interface IconRefresher {
  dispose(): void;
}

/**
 * What link icons depend on in a snapshot: each link key and whether its
 * document is in the Trash, in a fixed order.
 */
export function linkIconSignature(snapshot: LinkIndexSnapshot): string {
  const keys: string[] = [];
  for (const entry of snapshot.items) {
    if (entry.linkKey) keys.push(`${entry.linkKey}:live`);
  }
  for (const entry of snapshot.trashed ?? []) {
    if (entry.linkKey) keys.push(`${entry.linkKey}:trash`);
  }
  return keys.sort().join(",");
}

export function createIconRefresher({
  subscribe,
  getSnapshot,
  refresh,
  delayMs = 100,
}: IconRefresherOptions): IconRefresher {
  let snapshot = getSnapshot();
  let signature = linkIconSignature(snapshot);
  let timer: ReturnType<typeof setTimeout> | undefined;

  const check = () => {
    timer = undefined;
    const next = getSnapshot();
    // Snapshots keep their identity until something changes.
    if (next === snapshot) return;
    snapshot = next;
    const nextSignature = linkIconSignature(next);
    if (nextSignature === signature) return;
    signature = nextSignature;
    refresh();
  };

  const unsubscribe = subscribe(() => {
    clearTimeout(timer);
    timer = setTimeout(check, delayMs);
  });

  return {
    dispose() {
      clearTimeout(timer);
      timer = undefined;
      unsubscribe();
    },
  };
}
