import { getHocuspocusWsUrl } from "@/lib/hocuspocus";

import { createIndexedDbBackend, LocalDocStore } from "./local-doc-store";

/**
 * Build-time switch for offline copies of documents (default on). `0`
 * disables them and deletes copies already stored in the browser.
 */
export const OFFLINE_CACHE_ENABLED =
  process.env.NEXT_PUBLIC_OFFLINE_CACHE?.trim() !== "0";

/** Offline edits a document may collect before editing pauses (512 KiB). */
export const OFFLINE_EDIT_BUDGET_BYTES = 512 * 1024;

const DB_NAME = "tinydocy-offline";

let store: LocalDocStore | null | undefined;

function serverHost(): string {
  try {
    return new URL(getHocuspocusWsUrl()).host;
  } catch {
    return "unknown";
  }
}

/** The browser's local copy store, or null when disabled or unavailable. */
export function getLocalDocStore(): LocalDocStore | null {
  if (store !== undefined) return store;
  if (typeof window === "undefined") return null;
  if (!OFFLINE_CACHE_ENABLED) {
    store = null;
    try {
      indexedDB.deleteDatabase(DB_NAME);
    } catch {
      // Nothing stored, or storage blocked.
    }
    return store;
  }
  const backend = createIndexedDbBackend();
  store = backend ? new LocalDocStore(backend, serverHost()) : null;
  return store;
}

/** Deletes the local copy of one document (tab closed or deleted). */
export function removeLocalCopy(name: string): void {
  void getLocalDocStore()
    ?.remove(name)
    .catch(() => {});
}

/**
 * Drops copies of documents no longer in the tab list, plus expired and
 * excess ones. `keep` names documents still open or with unsynced edits.
 */
export function sweepLocalCopies(
  wanted: ReadonlySet<string>,
  keep: ReadonlySet<string>,
): void {
  void getLocalDocStore()
    ?.prune({ keep, isWanted: (name) => wanted.has(name) })
    .catch(() => {});
}

/** Deletes every offline copy on this device ("Delete offline data"). */
export async function clearOfflineData(): Promise<void> {
  await getLocalDocStore()?.clear();
}
