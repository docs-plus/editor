"use client";

import { HocuspocusProvider } from "@hocuspocus/provider";
import { useEffect, useState } from "react";
import * as Y from "yjs";

const WS_URL = "ws://127.0.0.1:1234";

export function useYjsDocument(documentId: string) {
  const [ydoc, setYdoc] = useState<Y.Doc | null>(null);
  const [synced, setSynced] = useState(false);

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: WS_URL,
      name: documentId,
      document: doc,
      onSynced() {
        setYdoc(doc);
        setSynced(true);
      },
    });

    return () => {
      provider.destroy();
      doc.destroy();
      setYdoc(null);
      setSynced(false);
    };
  }, [documentId]);

  return { ydoc, synced };
}
