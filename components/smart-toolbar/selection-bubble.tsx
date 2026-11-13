"use client";

import { type Editor, useCurrentEditor } from "@tiptap/react";
import { useEffect, useState } from "react";

import { lazySurface } from "./lazy-surface";
import type { SurfaceProps } from "./types";

/**
 * The bubble and its plugin are their own chunk; phones never fetch it.
 * If it fails to load there is no bubble (every action is in the row)
 * until the next editor mounts this again.
 */
const SelectionBubbleView = lazySurface(() =>
  import("./bubble/selection-bubble-view").then(
    (module) => module.SelectionBubbleView,
  ),
);

/**
 * Wider than the phone bar's viewport. The view shows the bubble only for
 * a fine pointer; every desktop gets its status pill.
 */
const DESKTOP_QUERY = "(min-width: 768px)";
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
 * Desktop selection bubble (spec §4.3, design pass §1): B · I · U │
 * colour split │ link │ Paint format, plus the desktop status pill (§5).
 * Mounted once per editor by `EditorSurfaces`. Phone widths get neither
 * (the phone bar swaps in place and carries its own pill).
 */
export function SelectionBubble({ editor: providedEditor }: SurfaceProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = providedEditor ?? contextEditor ?? null;
  const desktop = useDesktopPointer();
  const scrollTarget = useScrollTarget(desktop ? editor : null);
  if (!editor || !desktop || !scrollTarget) return null;
  return <SelectionBubbleView editor={editor} scrollTarget={scrollTarget} />;
}
