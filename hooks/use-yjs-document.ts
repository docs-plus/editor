"use client";

import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";

const DB_PREFIX = "tinydocy-doc-";

export function useYjsDocument(documentId: string) {
  const [synced, setSynced] = useState(false);
  const ydocRef = useRef<Y.Doc | null>(null);

  useEffect(() => {
    const ydoc = new Y.Doc();
    const provider = new IndexeddbPersistence(
      `${DB_PREFIX}${documentId}`,
      ydoc,
    );
    ydocRef.current = ydoc;

    const onSynced = () => setSynced(true);
    provider.on("synced", onSynced);

    return () => {
      provider.destroy();
      ydoc.destroy();
      ydocRef.current = null;
      setSynced(false);
    };
  }, [documentId]);

  return { ydoc: ydocRef.current, synced };
}

export function deleteDocumentDatabase(documentId: string) {
  if (typeof indexedDB !== "undefined") {
    indexedDB.deleteDatabase(`${DB_PREFIX}${documentId}`);
  }
}
