"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import * as Y from "yjs";

declare global {
  interface Window {
    __HOCUS_URL?: string;
    __HOCUS_TOKEN?: string;
  }
}

function getWsUrl(): string {
  if (typeof window !== "undefined" && window.__HOCUS_URL) {
    return window.__HOCUS_URL;
  }
  return "ws://127.0.0.1:1234";
}

function getToken(): string | undefined {
  if (typeof window !== "undefined" && window.__HOCUS_TOKEN) {
    return window.__HOCUS_TOKEN;
  }
  return undefined;
}

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
}

export function useYjsDocument(documentId: string) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const doc = acquireDoc(documentId);
    const token = getToken();
    const provider = new HocuspocusProvider({
      url: getWsUrl(),
      name: documentId,
      document: doc,
      ...(token ? { token } : {}),
      onSynced() {
        setSynced(true);
      },
    });

    setYdoc(doc);

    return () => {
      provider.destroy();
      releaseDoc(documentId);
      setYdoc(null);
      setSynced(false);
    };
  }, [documentId]);

  return { ydoc, synced };
}
