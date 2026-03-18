"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import * as Y from "yjs";

import { getHocuspocusToken, getHocuspocusWsUrl } from "@/lib/hocuspocus";

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
    });

    setYdoc(doc);
    setProviderRef(provider);

    return () => {
      provider.destroy();
      releaseDoc(documentId);
      setYdoc(null);
      setProviderRef(null);
      setSynced(false);
    };
  }, [documentId]);

  return { ydoc, provider: providerRef, synced };
}
