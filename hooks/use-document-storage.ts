"use client";

import { useEffect, useMemo } from "react";
import type { Editor, JSONContent } from "@tiptap/react";
import throttle from "lodash.throttle";

const STORAGE_KEY = "tinydocy-document";
const THROTTLE_MS = 1000;

export type StorageAdapter = {
  load: () => JSONContent | null;
  save: (content: JSONContent) => void;
};

export const localStorageAdapter: StorageAdapter = {
  load: () => {
    if (typeof window === "undefined") return null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as JSONContent) : null;
    } catch {
      localStorage.removeItem(STORAGE_KEY);
      return null;
    }
  },
  save: (content) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(content));
    } catch {
      // quota exceeded
    }
  },
};

export function getStoredContent(
  adapter: StorageAdapter = localStorageAdapter,
): JSONContent | null {
  return adapter.load();
}

export function useDocumentStorage(
  editor: Editor | null,
  adapter: StorageAdapter = localStorageAdapter,
) {
  const persist = useMemo(
    () =>
      throttle((e: Editor) => {
        adapter.save(e.getJSON());
      }, THROTTLE_MS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adapter],
  );

  useEffect(() => {
    if (!editor) return;

    const handler = () => persist(editor);
    editor.on("update", handler);
    return () => {
      editor.off("update", handler);
      persist.flush();
    };
  }, [editor, persist]);
}
