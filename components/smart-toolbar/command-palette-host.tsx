"use client";

import { useCurrentEditor } from "@tiptap/react";
import { lazy, useEffect, useState, useSyncExternalStore } from "react";

import { emitUiIntent, onUiIntent } from "@/lib/editor-actions/ui-intents";
import { loadV11Engine } from "@/lib/editor-actions/v11-actions";

import { SurfaceBoundary } from "./lazy-surface";
import {
  closePalette,
  getPaletteState,
  getServerPaletteState,
  openPalette,
  registerPaletteEditor,
  subscribePalette,
} from "./palette/palette-store";
import type { SurfaceProps } from "./types";

/**
 * The palette chunk (cmdk included), after the E engine it reads through
 * `getV11Engine()` (usually there already: editors load it on create).
 * Without the engine it still opens; E's rows then say they are loading.
 */
const loadPalette = () =>
  loadV11Engine()
    .catch(() => undefined)
    .then(() => import("./palette/command-palette"))
    .then((module) => ({ default: module.CommandPalette }));

/** Loaded on the first open only. */
let CommandPalette = lazy(loadPalette);

/** Why the palette did not open (design pass §8): never stay silent. */
const LOAD_FAILED =
  "Couldn’t open actions. Check your connection and try again.";
/** How long the failure note stays on screen. */
const FAILED_MS = 5000;

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
  const [failed, setFailed] = useState(false);

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

  // The note stands in for the status pill; the next Alt+/ hides it.
  useEffect(() => {
    if (!failed) return;
    if (state.editor) setFailed(false);
    const timer = setTimeout(() => setFailed(false), FAILED_MS);
    return () => clearTimeout(timer);
  }, [failed, state.editor]);

  if (!editor) return null;
  if (state.editor !== editor) {
    return failed ? (
      // An alert, so it is read although it mounts with its text.
      <p
        role="alert"
        className="fixed top-16 left-1/2 z-50 -translate-x-1/2 rounded-lg border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md"
      >
        {LOAD_FAILED}
      </p>
    ) : null;
  }
  return (
    <SurfaceBoundary
      onError={() => {
        // The chunk did not load (offline, or a deploy replaced it): close
        // the palette, so the next Alt+/ is a fresh open, and swap in a
        // fresh `lazy()` so that open fetches again (React keeps a
        // rejected one for good). Focus never left the editor: the dialog
        // had not rendered.
        CommandPalette = lazy(loadPalette);
        closePalette();
        setFailed(true);
      }}
    >
      <CommandPalette
        editor={editor}
        mode={state.mode}
        onClose={closePalette}
        onRemoveFormat={() => emitUiIntent(editor, { type: "formats.remove" })}
      />
    </SurfaceBoundary>
  );
}
