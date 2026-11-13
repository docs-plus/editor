"use client";

import { type Editor, useCurrentEditor } from "@tiptap/react";
import { lazy, Suspense, useEffect, useState } from "react";

import type { SurfaceProps } from "./types";

/** The bubble and its plugin are their own chunk; phones never fetch it. */
const SelectionBubbleView = lazy(() =>
  import("./bubble/selection-bubble-view").then((module) => ({
    default: module.SelectionBubbleView,
  })),
);

/** Desktop only: a fine pointer and a viewport wider than the phone bar's. */
const DESKTOP_QUERY = "(min-width: 768px) and (pointer: fine)";
const SCROLL_CONTAINER = ".document-editor-wrapper";

/** Read after hydration (a ready flag, never at first render). */
function useDesktopPointer(): boolean {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(DESKTOP_QUERY);
    const sync = () => setDesktop(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return desktop;
}

/** The editor's mounted view DOM, or null before `EditorContent` mounts it. */
function mountedViewDom(editor: Editor): HTMLElement | null {
  if (editor.isDestroyed) return null;
  try {
    return editor.view.dom;
  } catch {
    return null;
  }
}

/**
 * The scroll container the bubble is appended to and scrolls with. The
 * plugin reads it once, so the bubble waits until the view is mounted.
 */
function useScrollTarget(editor: Editor | null): HTMLElement | null {
  const [target, setTarget] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!editor) {
      setTarget(null);
      return;
    }
    const find = () =>
      setTarget(
        mountedViewDom(editor)?.closest<HTMLElement>(SCROLL_CONTAINER) ?? null,
      );
    find();
    editor.on("mount", find);
    return () => {
      editor.off("mount", find);
    };
  }, [editor]);
  return target;
}

/**
 * Desktop selection bubble (spec §4.3): B · I · U │ colour split │ link │
 * `RepeatSplitButton` (E). Mounted once per editor by `EditorSurfaces`.
 * Touch and phone widths get none (the phone bar swaps in place instead).
 */
export function SelectionBubble({ editor: providedEditor }: SurfaceProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = providedEditor ?? contextEditor ?? null;
  const desktop = useDesktopPointer();
  const scrollTarget = useScrollTarget(desktop ? editor : null);
  if (!editor || !desktop || !scrollTarget) return null;
  return (
    <Suspense fallback={null}>
      <SelectionBubbleView editor={editor} scrollTarget={scrollTarget} />
    </Suspense>
  );
}
