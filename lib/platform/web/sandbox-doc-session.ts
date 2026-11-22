/**
 * The web sandbox's `DocSession` (desktop architecture §4): an adapter over
 * `lib/collab-session.ts`, which stays as it is. Every behaviour (shared
 * socket, device copy, deferred release, refusals) is collab-session's; this
 * only reshapes it:
 *
 * - `ready` = renderable: synced once, or restored from the device copy;
 * - `authoritative` = the server has confirmed the document (`serverSynced`);
 * - `readOnlyReason` = collab-session's `rejectedReason`, unchanged.
 *
 * Only `EditorApp` imports this, so the editor chunk does not.
 */
import type { Awareness } from "y-protocols/awareness";

import {
  acquireCollabSession,
  flushAllLocalCopies,
  isSessionReady,
  releaseCollabSession,
  subscribeSession,
} from "@/lib/collab-session";
import type {
  DocHandle,
  DocSession,
  ReadOnlyReason,
} from "@/lib/platform/doc-session";
import { DOC_LOADING } from "@/lib/platform/doc-session-context";

/** The sandbox's one DocSession: stable, so effects keyed on it never re-run. */
export const sandboxDocSession: DocSession = {
  open(docId): DocHandle {
    const session = acquireCollabSession(docId);
    const { provider } = session;
    let state = DOC_LOADING;
    return {
      docId,
      doc: session.doc,
      // collab-session never turns the provider's awareness off.
      awareness: provider.awareness as Awareness,
      provider,
      // Read fresh, but the same object until a field changes.
      getState() {
        const ready = isSessionReady(session);
        const authoritative = session.hasSynced || provider.isSynced;
        // collab-session's reasons are the sandbox members of ReadOnlyReason.
        const readOnlyReason = session.rejectedReason as ReadOnlyReason | null;
        if (
          ready !== state.ready ||
          authoritative !== state.authoritative ||
          readOnlyReason !== state.readOnlyReason
        ) {
          state = { ready, authoritative, readOnlyReason, error: null };
        }
        return state;
      },
      subscribe(listener) {
        const unsubscribe = subscribeSession(session, listener);
        provider.on("synced", listener);
        return () => {
          unsubscribe();
          provider.off("synced", listener);
        };
      },
      flush: flushAllLocalCopies,
      // Once per open (the DocHandle contract), like releaseCollabSession.
      release: () => releaseCollabSession(docId),
    };
  },
  flush: flushAllLocalCopies,
};
