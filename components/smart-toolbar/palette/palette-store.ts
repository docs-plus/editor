/**
 * Page-wide palette state (eager, tiny). One capture-phase `keydown`
 * listener on `window`, `onPaletteKey`, added with the first registered
 * editor and removed with the last. `DocumentEditor` remounts per tab, so
 * editors register as a stack: the newest live one is the target, and a
 * late release from the previous tab never clears the new one.
 */
import type { Editor } from "@tiptap/core";

import { matchPaletteHotkey, shouldHandlePaletteKey } from "./hotkey";

export type PaletteMode = "actions" | "save-format";

export interface PaletteState {
  /** Editor the open palette acts on; null when closed. */
  editor: Editor | null;
  mode: PaletteMode;
  /** True once the lazy chunk was requested (stays true). */
  requested: boolean;
}

const CLOSED: PaletteState = {
  editor: null,
  mode: "actions",
  requested: false,
};
let state: PaletteState = CLOSED;
const editors: Editor[] = [];
const listeners = new Set<() => void>();

function set(next: PaletteState): void {
  state = next;
  for (const listener of listeners) listener();
}

export function getPaletteState(): PaletteState {
  return state;
}

export function getServerPaletteState(): PaletteState {
  return CLOSED;
}

export function subscribePalette(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The editor the palette would act on now. */
export function getActiveEditor(): Editor | null {
  for (let i = editors.length - 1; i >= 0; i--) {
    if (!editors[i].isDestroyed) return editors[i];
  }
  return null;
}

export function openPalette(
  editor: Editor,
  mode: PaletteMode = "actions",
): void {
  set({ editor, mode, requested: true });
}

export function closePalette(): void {
  if (state.editor) set({ ...state, editor: null, mode: "actions" });
}

export function onPaletteKey(event: KeyboardEvent): void {
  if (!matchPaletteHotkey(event)) return;
  const editor = getActiveEditor();
  if (!editor) return;
  if (!shouldHandlePaletteKey(event.target)) return;
  event.preventDefault();
  event.stopPropagation();
  const open = state.editor;
  if (!open) {
    openPalette(editor);
    return;
  }
  closePalette();
  if (!open.isDestroyed) open.view.focus();
}

const CAPTURE = { capture: true } as const;

/** Registers an editor; the returned release is idempotent. */
export function registerPaletteEditor(editor: Editor): () => void {
  editors.push(editor);
  if (editors.length === 1 && typeof window !== "undefined") {
    window.addEventListener("keydown", onPaletteKey, CAPTURE);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const index = editors.lastIndexOf(editor);
    if (index >= 0) editors.splice(index, 1);
    if (state.editor === editor) closePalette();
    if (editors.length === 0 && typeof window !== "undefined") {
      window.removeEventListener("keydown", onPaletteKey, CAPTURE);
    }
  };
}
