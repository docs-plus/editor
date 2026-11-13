"use client";

import type { Editor } from "@tiptap/react";
import { useCurrentEditor } from "@tiptap/react";
import { useSyncExternalStore } from "react";

import type { ActionView, Ctx } from "@/lib/editor-actions/types";
import { getEditorContextStore } from "@/lib/editor-context/store";

const noopSubscribe = () => () => {};
const getNull = () => null;

function useStoreEditor(provided?: Editor | null): Editor | null {
  const { editor } = useCurrentEditor();
  return provided ?? editor ?? null;
}

/**
 * One control's view of one action. Re-renders only when that view
 * changes (`getView` keeps its identity otherwise). Owned by PR D1.
 */
export function useActionView(
  id: string,
  providedEditor?: Editor | null,
): ActionView | null {
  const editor = useStoreEditor(providedEditor);
  const store = editor ? getEditorContextStore(editor) : null;
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store ? () => store.getView(id) : getNull,
    getNull,
  );
}

/** The live snapshot; re-renders on every store version. Use sparingly. */
export function useEditorContext(providedEditor?: Editor | null): Ctx | null {
  const editor = useStoreEditor(providedEditor);
  const store = editor ? getEditorContextStore(editor) : null;
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    store?.getContext ?? getNull,
    getNull,
  );
}
