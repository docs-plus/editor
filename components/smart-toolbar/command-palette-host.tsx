"use client";

import { useCurrentEditor } from "@tiptap/react";
import dynamic from "next/dynamic";
import { useEffect, useSyncExternalStore } from "react";

import { onUiIntent } from "@/lib/editor-actions/ui-intents";

import {
  closePalette,
  getPaletteState,
  getServerPaletteState,
  openPalette,
  registerPaletteEditor,
  subscribePalette,
} from "./palette/palette-store";
import type { SurfaceProps } from "./types";

/** The palette chunk (cmdk included): loaded on the first open only. */
const CommandPalette = dynamic(
  () => import("./palette/command-palette").then((m) => m.CommandPalette),
  { ssr: false },
);

/**
 * Alt+/ (fallback Alt+Shift+Z) palette host (spec §4.4). Mounted once per
 * editor by `EditorSurfaces`. It registers its editor with the page-wide
 * palette store, which owns the one capture-phase `keydown` listener, and
 * opens on the `palette.open` UI intent ("All actions…"). Nothing from the
 * palette chunk loads before the first open.
 */
export function CommandPaletteHost({ editor: provided }: SurfaceProps) {
  const { editor: contextEditor } = useCurrentEditor();
  const editor = provided ?? contextEditor ?? null;
  const state = useSyncExternalStore(
    subscribePalette,
    getPaletteState,
    getServerPaletteState,
  );

  useEffect(() => {
    if (!editor) return;
    const release = registerPaletteEditor(editor);
    const unsubscribe = onUiIntent(editor, (intent) => {
      if (intent.type !== "palette.open") return false;
      openPalette(editor);
      return true;
    });
    return () => {
      unsubscribe();
      release();
    };
  }, [editor]);

  if (!editor || state.editor !== editor) return null;
  return (
    <CommandPalette editor={editor} mode={state.mode} onClose={closePalette} />
  );
}
