"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import type * as Y from "yjs";

import {
  acquireCollabSession,
  onSynced,
  releaseCollabSession,
} from "@/lib/collab-session";

/** Close reason Hocuspocus sends when an update would exceed the size cap. */
export const DOCUMENT_TOO_LARGE_REASON = "document_too_large";

export function useYjsDocument(documentId: string) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [providerRef, setProviderRef] = useState<HocuspocusProvider | null>(
    null,
  );
  const [synced, setSynced] = useState(false);
  /** Set when the server refuses this document's updates (size cap). */
  const [rejectedReason, setRejectedReason] = useState<string | null>(null);

  useEffect(() => {
    const { doc, provider } = acquireCollabSession(documentId);
    const stopSyncListener = onSynced(provider, () => setSynced(true));
    const onClose = ({ event }: { event: { reason?: string } }) => {
      if (event.reason === DOCUMENT_TOO_LARGE_REASON) {
        setRejectedReason(event.reason);
      }
    };
    provider.on("close", onClose);
    setYdoc(doc);
    setProviderRef(provider);

    return () => {
      stopSyncListener();
      provider.off("close", onClose);
      releaseCollabSession(documentId);
      setYdoc(null);
      setProviderRef(null);
      setSynced(false);
      setRejectedReason(null);
    };
  }, [documentId]);

  return { ydoc, provider: providerRef, synced, rejectedReason };
}
