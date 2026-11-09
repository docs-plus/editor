"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import type * as Y from "yjs";

import {
  acquireCollabSession,
  isSessionReady,
  releaseCollabSession,
  subscribeSession,
} from "@/lib/collab-session";

export function useYjsDocument(documentId: string) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [providerRef, setProviderRef] = useState<HocuspocusProvider | null>(
    null,
  );
  /** Renderable: synced with the server, or restored from the offline copy. */
  const [synced, setSynced] = useState(false);
  /** The server has confirmed this document at least once. */
  const [serverSynced, setServerSynced] = useState(false);
  /** Why edits are refused (size cap, deleted, offline budget), if they are. */
  const [rejectedReason, setRejectedReason] = useState<string | null>(null);

  useEffect(() => {
    const session = acquireCollabSession(documentId);
    const { doc, provider } = session;
    const sync = () => {
      setSynced(isSessionReady(session));
      setServerSynced(session.hasSynced || provider.isSynced);
      setRejectedReason(session.rejectedReason);
    };
    sync();
    const unsubscribe = subscribeSession(session, sync);
    provider.on("synced", sync);
    setYdoc(doc);
    setProviderRef(provider);

    return () => {
      unsubscribe();
      provider.off("synced", sync);
      releaseCollabSession(documentId);
      setYdoc(null);
      setProviderRef(null);
      setSynced(false);
      setServerSynced(false);
      setRejectedReason(null);
    };
  }, [documentId]);

  return {
    ydoc,
    provider: providerRef,
    synced,
    serverSynced,
    rejectedReason,
  };
}
