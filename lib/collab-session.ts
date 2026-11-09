import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import {
  getHocuspocusToken,
  getSharedHocuspocusSocket,
} from "@/lib/hocuspocus";
import {
  bindLocalCopy,
  getLocalDocStore,
  LOCAL_ORIGIN,
  type LocalBinding,
  OFFLINE_EDIT_BUDGET_BYTES,
  removeLocalCopy,
} from "@/lib/offline";

/** How long an unused session stays open before it detaches. */
const RELEASE_DELAY_MS = 1000;

/** How often a released session with unsynced edits checks whether it can go. */
const DIRTY_RECHECK_MS = 5000;

/** Close reason Hocuspocus sends when an update would exceed the size cap. */
export const DOCUMENT_TOO_LARGE_REASON = "document_too_large";
/** Auth refusal for a document that was deleted (tombstoned). */
export const DOCUMENT_DELETED_REASON = "document_deleted";
/** Local pause: too many edits collected offline (clears on sync). */
export const OFFLINE_BUDGET_REASON = "offline_budget";

/**
 * How long to wait for the local copy before connecting without it.
 * Applying it after the provider synced would upload the whole copy again.
 */
const HYDRATE_TIMEOUT_MS = 1000;

export type CollabSession = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** Why this document's edits are refused (size, deleted, offline budget). */
  rejectedReason: string | null;
  /** The document was rendered from its offline copy before the server synced. */
  hasLocalCopy: boolean;
  /**
   * The document has synced with the server at least once, so its content
   * is real even while the socket is down (the provider resets `isSynced`
   * on every disconnect).
   */
  hasSynced: boolean;
};

type Entry = CollabSession & {
  refs: number;
  /** Local edits the server has not acknowledged yet. */
  dirty: boolean;
  /** Bytes of local edits made while not synced. */
  offlineBytes: number;
  binding: LocalBinding | null;
  listeners: Set<() => void>;
  releaseTimer?: ReturnType<typeof setTimeout>;
};

function notify(entry: Entry): void {
  for (const listener of entry.listeners) listener();
}

function reject(entry: Entry, reason: string): void {
  if (entry.rejectedReason === reason) return;
  entry.rejectedReason = reason;
  notify(entry);
}

const sessions = new Map<string, Entry>();
const unsyncedListeners = new Set<() => void>();

function setDirty(entry: Entry, dirty: boolean): void {
  if (entry.dirty === dirty) return;
  entry.dirty = dirty;
  for (const listener of unsyncedListeners) listener();
}

/** Calls `listener` whenever `hasUnsyncedCollabChanges()` may have changed. */
export function subscribeUnsyncedChanges(listener: () => void): () => void {
  unsyncedListeners.add(listener);
  return () => {
    unsyncedListeners.delete(listener);
  };
}

/**
 * True while any open or recently closed document has local edits the
 * server has not acknowledged (typed offline, or still in flight).
 */
export function hasUnsyncedCollabChanges(): boolean {
  for (const entry of sessions.values()) if (entry.dirty) return true;
  return false;
}

/**
 * One Y.Doc and provider per document name, shared by every component that
 * needs it and multiplexed on the shared WebSocket.
 *
 * Release is deferred: on a shared socket, detaching sends a Close for the
 * document name, and an attach for the same name right after (React
 * StrictMode's mount/unmount/mount, or switching back to a tab) races that
 * Close on the server and loses the connection. Reusing the live session
 * within the delay avoids the round trip entirely.
 */
export function acquireCollabSession(name: string): CollabSession {
  const existing = sessions.get(name);
  if (existing) {
    clearTimeout(existing.releaseTimer);
    existing.releaseTimer = undefined;
    existing.refs++;
    return existing;
  }
  const doc = new Y.Doc();
  const token = getHocuspocusToken();
  const provider = new HocuspocusProvider({
    websocketProvider: getSharedHocuspocusSocket(),
    name,
    document: doc,
    ...(token ? { token } : {}),
  });
  const entry: Entry = {
    doc,
    provider,
    refs: 1,
    rejectedReason: null,
    hasSynced: false,
    hasLocalCopy: false,
    dirty: false,
    offlineBytes: 0,
    binding: null,
    listeners: new Set(),
  };
  provider.on("synced", () => {
    entry.hasSynced = true;
    entry.offlineBytes = 0;
    if (entry.rejectedReason === OFFLINE_BUDGET_REASON) {
      entry.rejectedReason = null;
    }
    notify(entry);
  });
  // Local edits (y-prosemirror, seeding, tab list changes) have an origin
  // other than the provider. Restoring the offline copy is not an edit. A
  // refused document can never sync them.
  doc.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin === provider || origin === LOCAL_ORIGIN) return;
    if (entry.rejectedReason) return;
    setDirty(entry, true);
    if (provider.isSynced) return;
    entry.offlineBytes += update.byteLength;
    if (entry.offlineBytes > OFFLINE_EDIT_BUDGET_BYTES) {
      reject(entry, OFFLINE_BUDGET_REASON);
    }
  });
  // The provider resets its count to 1 on every (re)connect and counts down
  // as the server acknowledges, so 0 means the server has everything.
  provider.on("unsyncedChanges", ({ number }: { number: number }) => {
    if (number === 0) setDirty(entry, false);
  });
  provider.on("authenticationFailed", ({ reason }: { reason: string }) => {
    // A refused document (deleted tab, rate limit) will never acknowledge.
    setDirty(entry, false);
    if (reason !== DOCUMENT_DELETED_REASON) return;
    // Deleted while this copy was away: never resurrect it from the device.
    provider.detach();
    entry.binding?.destroy();
    removeLocalCopy(name);
    reject(entry, DOCUMENT_DELETED_REASON);
  });
  // After a size refusal, stop syncing this document instead of
  // re-authenticating on every reconnect: each retry resends the refused
  // update, and enough retries get the visitor's IP banned by Throttle.
  provider.on("close", ({ event }: { event: { reason?: string } }) => {
    if (event.reason !== DOCUMENT_TOO_LARGE_REASON || entry.rejectedReason) {
      return;
    }
    provider.detach();
    setDirty(entry, false);
    reject(entry, DOCUMENT_TOO_LARGE_REASON);
  });

  attachWithLocalCopy(entry, name);
  sessions.set(name, entry);
  return entry;
}

/**
 * Drops one reference. A session with edits the server has not acknowledged
 * stays attached, however long the socket is down, so they are not lost: on
 * reconnect the provider's sync step 2 sends them.
 */
export function releaseCollabSession(name: string): void {
  const entry = sessions.get(name);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0 || entry.releaseTimer) return;
  const tryRelease = () => {
    entry.releaseTimer = undefined;
    if (entry.refs > 0) return;
    if (entry.dirty) {
      entry.releaseTimer = setTimeout(tryRelease, DIRTY_RECHECK_MS);
      return;
    }
    sessions.delete(name);
    void entry.binding?.flush().finally(() => entry.binding?.destroy());
    entry.provider.destroy();
    entry.doc.destroy();
  };
  entry.releaseTimer = setTimeout(tryRelease, RELEASE_DELAY_MS);
}

/**
 * Restores the offline copy into the empty doc, then attaches the provider,
 * so the sync handshake only exchanges what either side is missing.
 */
function attachWithLocalCopy(entry: Entry, name: string): void {
  const store = getLocalDocStore();
  if (!store) {
    entry.provider.attach();
    return;
  }
  let attached = false;
  const attach = () => {
    if (attached || !sessions.has(name)) return;
    attached = true;
    entry.provider.attach();
  };
  entry.binding = bindLocalCopy(entry.doc, name, store);
  const timeout = setTimeout(() => {
    if (attached) return;
    // Too slow: connect without the copy and keep saving from here on.
    entry.binding?.destroy();
    entry.binding = bindLocalCopy(entry.doc, name, store, { hydrate: false });
    attach();
  }, HYDRATE_TIMEOUT_MS);
  void entry.binding.hydrated.then((hasCopy) => {
    if (attached) return;
    clearTimeout(timeout);
    if (hasCopy) {
      entry.hasLocalCopy = true;
      notify(entry);
    }
    attach();
  });
}

/** Ready to render: synced with the server once, or restored from the device. */
export function isSessionReady(session: CollabSession): boolean {
  return session.provider.isSynced || session.hasSynced || session.hasLocalCopy;
}

/** Calls `listener` when the session becomes ready, syncs or is refused. */
export function subscribeSession(
  session: CollabSession,
  listener: () => void,
): () => void {
  const entry = session as Entry;
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
  };
}

/**
 * Deletes a document's offline copy and stops saving it (tab closed or
 * document deleted), so a session still open or releasing cannot write it
 * back.
 */
export function forgetLocalCopy(name: string): void {
  const entry = sessions.get(name);
  if (entry?.binding) {
    entry.binding.destroy();
    entry.binding = null;
  }
  removeLocalCopy(name);
}

/** Writes every pending offline copy now (page hidden or closing). */
function flushLocalCopies(): void {
  for (const entry of sessions.values()) void entry.binding?.flush();
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushLocalCopies);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushLocalCopies();
  });
}

/** Names of sessions still open or holding unsynced edits. */
export function liveSessionNames(): Set<string> {
  return new Set(sessions.keys());
}

/**
 * Calls `handler` on every sync of the session's provider, and right away
 * if it is already ready: a reused session will not emit `synced` again,
 * one reused while offline still holds its content, and one restored from
 * its offline copy can render before the server answers.
 */
export function onSynced(
  session: CollabSession,
  handler: () => void,
): () => void {
  let ready = isSessionReady(session);
  const onChange = () => {
    if (ready || !isSessionReady(session)) return;
    ready = true;
    handler();
  };
  session.provider.on("synced", handler);
  const unsubscribe = subscribeSession(session, onChange);
  if (ready) handler();
  return () => {
    session.provider.off("synced", handler);
    unsubscribe();
  };
}
