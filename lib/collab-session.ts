import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import {
  getHocuspocusToken,
  getSharedHocuspocusSocket,
} from "@/lib/hocuspocus";

/** How long an unused session stays open before it detaches. */
const RELEASE_DELAY_MS = 1000;

/** How often a released session with unsynced edits checks whether it can go. */
const DIRTY_RECHECK_MS = 5000;

/** Close reason Hocuspocus sends when an update would exceed the size cap. */
export const DOCUMENT_TOO_LARGE_REASON = "document_too_large";

export type CollabSession = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** Set once the server refused this document's updates; it stays local. */
  rejectedReason: string | null;
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
  releaseTimer?: ReturnType<typeof setTimeout>;
};

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
  provider.attach();
  const entry: Entry = {
    doc,
    provider,
    refs: 1,
    rejectedReason: null,
    hasSynced: false,
    dirty: false,
  };
  provider.on("synced", () => {
    entry.hasSynced = true;
  });
  // Local edits (y-prosemirror, seeding, tab list changes) have an origin
  // other than the provider. A refused document can never sync them.
  doc.on("update", (_update: Uint8Array, origin: unknown) => {
    if (origin !== provider && !entry.rejectedReason) setDirty(entry, true);
  });
  // The provider resets its count to 1 on every (re)connect and counts down
  // as the server acknowledges, so 0 means the server has everything.
  provider.on("unsyncedChanges", ({ number }: { number: number }) => {
    if (number === 0) setDirty(entry, false);
  });
  // A refused document (deleted tab, rate limit) will never acknowledge.
  provider.on("authenticationFailed", () => setDirty(entry, false));
  // After a size refusal, stop syncing this document instead of
  // re-authenticating on every reconnect: each retry resends the refused
  // update, and enough retries get the visitor's IP banned by Throttle.
  provider.on("close", ({ event }: { event: { reason?: string } }) => {
    if (event.reason !== DOCUMENT_TOO_LARGE_REASON || entry.rejectedReason) {
      return;
    }
    entry.rejectedReason = event.reason;
    provider.detach();
    setDirty(entry, false);
  });
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
    entry.provider.destroy();
    entry.doc.destroy();
  };
  entry.releaseTimer = setTimeout(tryRelease, RELEASE_DELAY_MS);
}

/**
 * Calls `handler` on every sync of the session's provider, and right away
 * if it has synced before: a reused session will not emit `synced` again,
 * and one reused while offline still holds its content.
 */
export function onSynced(
  session: CollabSession,
  handler: () => void,
): () => void {
  const { provider } = session;
  provider.on("synced", handler);
  if (provider.isSynced || session.hasSynced) handler();
  return () => {
    provider.off("synced", handler);
  };
}
