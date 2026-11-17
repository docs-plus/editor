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
  type CollabSession,
  flushAllLocalCopies,
  isSessionReady,
  releaseCollabSession,
  subscribeSession,
} from "@/lib/collab-session";
import type {
  DocHandle,
  DocHandleState,
  DocSession,
  ReadOnlyReason,
} from "@/lib/platform/doc-session";

/** The parts of `collab-session` the adapter uses; tests pass fakes. */
export type CollabSessionApi = {
  acquire(name: string): CollabSession;
  release(name: string): void;
  isReady(session: CollabSession): boolean;
  subscribe(session: CollabSession, listener: () => void): () => void;
  flushAll(): Promise<void>;
};

const collabSessionApi: CollabSessionApi = {
  acquire: acquireCollabSession,
  release: releaseCollabSession,
  isReady: isSessionReady,
  subscribe: subscribeSession,
  flushAll: flushAllLocalCopies,
};

function stateOf(
  api: CollabSessionApi,
  session: CollabSession,
): DocHandleState {
  return {
    ready: api.isReady(session),
    authoritative: session.hasSynced || session.provider.isSynced,
    // collab-session's reasons are the sandbox members of ReadOnlyReason.
    readOnlyReason: session.rejectedReason as ReadOnlyReason | null,
    error: null,
  };
}

function sameState(a: DocHandleState, b: DocHandleState): boolean {
  return (
    a.ready === b.ready &&
    a.authoritative === b.authoritative &&
    a.readOnlyReason === b.readOnlyReason
  );
}

export function createSandboxDocSession(
  api: CollabSessionApi = collabSessionApi,
): DocSession {
  return {
    open(docId): DocHandle {
      const session = api.acquire(docId);
      const { provider } = session;
      // collab-session never turns the provider's awareness off.
      const awareness = provider.awareness as Awareness;
      let state = stateOf(api, session);
      let released = false;
      return {
        docId,
        doc: session.doc,
        awareness,
        provider,
        // Read fresh, but the same object until a field changes.
        getState() {
          const next = stateOf(api, session);
          if (!sameState(next, state)) state = next;
          return state;
        },
        subscribe(listener) {
          const unsubscribe = api.subscribe(session, listener);
          provider.on("synced", listener);
          return () => {
            unsubscribe();
            provider.off("synced", listener);
          };
        },
        flush: () => api.flushAll(),
        release() {
          if (released) return;
          released = true;
          api.release(docId);
        },
      };
    },
    flush: () => api.flushAll(),
  };
}

/** The sandbox's one DocSession: stable, so effects keyed on it never re-run. */
export const sandboxDocSession: DocSession = createSandboxDocSession();
