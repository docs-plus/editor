"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

import type { DocHandle } from "@/lib/platform/doc-session";
import { DOC_LOADING, useDocSession } from "@/lib/platform/doc-session-context";

const subscribeNone = () => () => {};
const getLoading = () => DOC_LOADING;

/**
 * Opens `documentId` through the `DocSession` in context (the sandbox's
 * collab-session on the web, `local-session` on desktop and in the library)
 * and keeps it open while mounted. Imports no adapter (architecture §3.3).
 */
export function useYjsDocument(documentId: string) {
  const docSession = useDocSession();
  const [handle, setHandle] = useState<DocHandle | null>(null);

  useEffect(() => {
    const opened = docSession.open(documentId);
    setHandle(opened);
    // The next open replaces the handle in the same flush.
    return opened.release;
  }, [docSession, documentId]);

  const state = useSyncExternalStore(
    handle ? handle.subscribe : subscribeNone,
    handle ? handle.getState : getLoading,
    getLoading,
  );

  return {
    /** Undefined until the first open. */
    ydoc: handle?.doc,
    /** The session's one Awareness (DocSession shape). */
    awareness: handle?.awareness,
    provider: handle?.provider ?? null,
    /** Renderable: loaded, synced, or restored from the device copy. */
    synced: state.ready,
    /** This copy is the authority (server confirmed, or a local library). */
    serverSynced: state.authoritative,
    /** Why edits are refused, if they are. */
    rejectedReason: state.readOnlyReason,
  };
}
