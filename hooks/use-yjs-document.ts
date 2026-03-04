"use client";

import { useEffect, useState } from "react";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

const DB_PREFIX = "tinydocy-doc-";

export function useYjsDocument(documentId: string) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new IndexeddbPersistence(`${DB_PREFIX}${documentId}`, doc);

    const onSynced = () => {
      setYdoc(doc);
      setSynced(true);
    };
    provider.on("synced", onSynced);

    return () => {
      provider.destroy();
      doc.destroy();
      setYdoc(null);
      setSynced(false);
    };
  }, [documentId]);

  return { ydoc, synced };
}

export function deleteDocumentDatabase(documentId: string) {
  if (typeof indexedDB !== "undefined") {
    indexedDB.deleteDatabase(`${DB_PREFIX}${documentId}`);
  }
}
