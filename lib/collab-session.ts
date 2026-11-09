import { HocuspocusProvider } from "@hocuspocus/provider";
import * as Y from "yjs";

import {
  getHocuspocusToken,
  getSharedHocuspocusSocket,
} from "@/lib/hocuspocus";

/** How long an unused session stays open before it detaches. */
const RELEASE_DELAY_MS = 1000;

/** Close reason Hocuspocus sends when an update would exceed the size cap. */
export const DOCUMENT_TOO_LARGE_REASON = "document_too_large";

export type CollabSession = {
  doc: Y.Doc;
  provider: HocuspocusProvider;
  /** Set once the server refused this document's updates; it stays local. */
  rejectedReason: string | null;
};

type Entry = CollabSession & {
  refs: number;
  releaseTimer?: ReturnType<typeof setTimeout>;
};

const sessions = new Map<string, Entry>();

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
  const entry: Entry = { doc, provider, refs: 1, rejectedReason: null };
  // After a size refusal, stop syncing this document instead of
  // re-authenticating on every reconnect: each retry resends the refused
  // update, and enough retries get the visitor's IP banned by Throttle.
  provider.on("close", ({ event }: { event: { reason?: string } }) => {
    if (event.reason !== DOCUMENT_TOO_LARGE_REASON || entry.rejectedReason) {
      return;
    }
    entry.rejectedReason = event.reason;
    provider.detach();
  });
  sessions.set(name, entry);
  return entry;
}

export function releaseCollabSession(name: string): void {
  const entry = sessions.get(name);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0 || entry.releaseTimer) return;
  entry.releaseTimer = setTimeout(() => {
    if (entry.refs > 0) return;
    sessions.delete(name);
    entry.provider.destroy();
    entry.doc.destroy();
  }, RELEASE_DELAY_MS);
}

/**
 * Calls `handler` on every sync of `provider`, and right away if it has
 * already synced (a reused session will not emit `synced` again).
 */
export function onSynced(
  provider: HocuspocusProvider,
  handler: () => void,
): () => void {
  provider.on("synced", handler);
  if (provider.isSynced) handler();
  return () => {
    provider.off("synced", handler);
  };
}
