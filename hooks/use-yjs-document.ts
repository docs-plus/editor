"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import * as Y from "yjs";

import { getHocuspocusToken, getHocuspocusWsUrl } from "@/lib/hocuspocus";

/** Close reason Hocuspocus sends when an update would exceed the size cap. */
export const DOCUMENT_TOO_LARGE_REASON = "document_too_large";

const docCache = new Map<string, { doc: Y.Doc; refCount: number }>();

function acquireDoc(documentId: string): Y.Doc {
  let entry = docCache.get(documentId);
  if (!entry) {
    entry = { doc: new Y.Doc(), refCount: 0 };
    docCache.set(documentId, entry);
  }
  entry.refCount++;
  return entry.doc;
}

function releaseDoc(documentId: string): void {
  const entry = docCache.get(documentId);
  if (!entry) return;
  entry.refCount--;
  if (entry.refCount <= 0) {
    entry.doc.destroy();
    docCache.delete(documentId);
  }
}

export function useYjsDocument(documentId: string) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [providerRef, setProviderRef] = useState<HocuspocusProvider | null>(
    null,
  );
  const [synced, setSynced] = useState(false);
  /** Set when the server refuses this document's updates (size cap). */
  const [rejectedReason, setRejectedReason] = useState<string | null>(null);

  useEffect(() => {
    const doc = acquireDoc(documentId);
    const token = getHocuspocusToken();
    const provider = new HocuspocusProvider({
      url: getHocuspocusWsUrl(),
      name: documentId,
      document: doc,
      ...(token ? { token } : {}),
      onSynced() {
        setSynced(true);
      },
      onClose({ event }) {
        if (event.reason === DOCUMENT_TOO_LARGE_REASON) {
          setRejectedReason(event.reason);
        }
      },
    });

    setYdoc(doc);
    setProviderRef(provider);

    return () => {
      provider.destroy();
      releaseDoc(documentId);
      setYdoc(null);
      setProviderRef(null);
      setSynced(false);
      setRejectedReason(null);
    };
  }, [documentId]);

  return { ydoc, provider: providerRef, synced, rejectedReason };
}
