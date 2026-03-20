"use client";

import type { JSONContent } from "@tiptap/core";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef } from "react";
import type * as Y from "yjs";

import { PLAYGROUND_ID } from "@/lib/constants";
import { getUserIdentity } from "@/lib/user-identity";

interface UseDocumentEditorEffectsOptions {
  editor: Editor | null;
  ydoc: Y.Doc;
  documentId: string;
  playgroundRegenerateTrigger?: number;
  readInitialFilter: () => { slugs: string[]; mode: "or" | "and" } | null;
  openFilterBar: () => void;
  toggleFilterBar: () => void;
  generatePlaygroundContent: () => JSONContent;
  defaultContent: JSONContent;
}

export function useDocumentEditorEffects({
  editor,
  ydoc,
  documentId,
  playgroundRegenerateTrigger,
  readInitialFilter,
  openFilterBar,
  toggleFilterBar,
  generatePlaygroundContent,
  defaultContent,
}: UseDocumentEditorEffectsOptions) {
  const toggleFilterBarRef = useRef(toggleFilterBar);

  useEffect(() => {
    toggleFilterBarRef.current = toggleFilterBar;
  }, [toggleFilterBar]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && editor) {
      window.__tiptap_editor = editor;
      return () => {
        delete window.__tiptap_editor;
      };
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.updateUser(getUserIdentity());
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const initial = readInitialFilter();
    if (initial && initial.slugs.length > 0) {
      editor.commands.applyFilter(initial.slugs, initial.mode);
      openFilterBar();
    }
  }, [editor, openFilterBar, readInitialFilter]);

  useEffect(() => {
    if (
      !editor ||
      documentId !== PLAYGROUND_ID ||
      !playgroundRegenerateTrigger ||
      playgroundRegenerateTrigger <= 0
    ) {
      return;
    }
    editor.commands.setContent(generatePlaygroundContent());
  }, [
    editor,
    documentId,
    playgroundRegenerateTrigger,
    generatePlaygroundContent,
  ]);

  useEffect(() => {
    if (!editor || !ydoc) return;
    const fragment = ydoc.getXmlFragment("default");
    if (fragment.length > 0) return;
    const content =
      documentId === PLAYGROUND_ID
        ? generatePlaygroundContent()
        : defaultContent;
    editor.commands.setContent(content);
  }, [editor, ydoc, documentId, generatePlaygroundContent, defaultContent]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        toggleFilterBarRef.current();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
