"use client";

import type { Editor, TiptapEditorHTMLElement } from "@tiptap/core";
import {
  type ComponentType,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type {
  FindBarProps,
  FindMemory,
  FindRequest,
} from "@/components/find/find-bar";
import {
  type FindCommand,
  findAvailable,
  isFindKeyTarget,
  isMacPlatform,
  matchFindShortcut,
} from "@/components/find/find-keys";

const loadFindBar = () =>
  import("@/components/find/find-bar").then((module) => module.FindBar);

const DESKTOP_APP = process.env.NEXT_PUBLIC_APP_TARGET === "desktop";

/**
 * The open document's editor, read from its DOM (Tiptap sets `editor` on
 * the ProseMirror element), so Find needs nothing from the editor chunk.
 */
function documentEditor(): Editor | null {
  const dom = document.querySelector<TiptapEditorHTMLElement>(
    ".document-editor-content .ProseMirror",
  );
  const editor = dom?.editor;
  return editor && !editor.isDestroyed ? editor : null;
}

interface Session {
  editor: Editor;
  request: FindRequest;
}

let seq = 0;

/**
 * Find in the document (P2.11): the window keys (`matchFindShortcut`)
 * and the lazy find bar. It lives in the app shell, outside the editor
 * chunk, which it costs nothing: the bar's chunk is fetched when the
 * browser is first idle (so ⌘F opens it at once, and offline), or on the
 * first ⌘F. A key that a focused list has already handled
 * (`defaultPrevented`, P2.7b's scoped ⌘F), or that is pressed in another
 * field or a dialog (`isFindKeyTarget`), is left alone. Where hits can't
 * be painted (`findAvailable`), the browser keeps its own find bar.
 */
export function FindLoader() {
  const [session, setSession] = useState<Session | null>(null);
  const [Bar, setBar] = useState<ComponentType<FindBarProps> | null>(null);
  const memory = useRef<FindMemory>({
    query: "",
    replacement: "",
    caseSensitive: false,
    wholeWord: false,
  });
  const open = useRef(false);
  open.current = session !== null;

  useEffect(() => {
    if (!findAvailable()) return;
    const load = () =>
      loadFindBar().then(
        (bar) => setBar(() => bar),
        () => {},
      );
    const idle = window.requestIdleCallback
      ? window.requestIdleCallback(load)
      : window.setTimeout(load, 2000);
    const context = { mac: isMacPlatform(), desktop: DESKTOP_APP };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const command: FindCommand | null = matchFindShortcut(event, context);
      if (!command || !isFindKeyTarget(event.target)) return;
      const stepping = command === "next" || command === "previous";
      // ⌘G with nothing to find stays the browser's.
      if (stepping && !open.current && !memory.current.query) return;
      const editor = documentEditor();
      if (!editor) return;
      event.preventDefault();
      seq += 1;
      setSession((current) => ({
        editor,
        request: {
          command,
          seq,
          opened: current === null || current.editor !== editor,
        },
      }));
      void load();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
      else window.clearTimeout(idle);
    };
  }, []);

  const close = useCallback(() => setSession(null), []);

  if (!session || !Bar) return null;
  return (
    <Bar
      key={session.editor.instanceId}
      editor={session.editor}
      request={session.request}
      memory={memory.current}
      onClose={close}
    />
  );
}
