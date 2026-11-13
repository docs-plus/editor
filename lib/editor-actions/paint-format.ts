/**
 * Paint format (design pass §2): pick up the formatting at the selection,
 * then paint it onto the next selection. Part of the lazy engine: only
 * `v11-engine.ts` imports this module, and surfaces reach it through
 * `getV11Engine().paint`, so its code lives in exactly one chunk.
 *
 * The armed state is per editor and lives here, never in a component: the
 * bubble's brush unmounts whenever the bubble hides, and the phone's when
 * a collapsed selection swaps the bar back. Its listeners exist only
 * while armed.
 */
import type { Editor } from "@tiptap/core";

import { applyDisabledReason } from "@/extensions/repeat-formatting/apply-bundle";
import {
  bundleSetLabel,
  type FormatBundle,
  readBundleAt,
} from "@/extensions/repeat-formatting/bundle";
import { rememberBundle } from "@/extensions/repeat-formatting/bundle-memory";
import type { RepeatFormattingStorage } from "@/extensions/repeat-formatting/repeat-formatting";
import { announce, dismissNotice } from "@/lib/announce";

/** On the editor's `EditorContent` element (ProseMirror owns `view.dom`'s class). */
export const PAINTING_CLASS = "is-painting";

export const PAINT_PILLS = {
  pointer: "Select text to paint · Esc to cancel",
  touch: "Select text, then tap 🖌 to apply",
  applied: "Formatting applied",
} as const;

interface Armed {
  bundle: FormatBundle;
  /** The selection it was armed on: the brush again on it cancels. */
  from: number;
  to: number;
  stop: () => void;
}

const armed = new WeakMap<Editor, Armed>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export const isPainting = (editor: Editor): boolean => armed.has(editor);

/** Change feed for the brushes (`useSyncExternalStore`). */
export function subscribePaint(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Disarms without applying (Esc, the brush again, read-only, destroy). */
export function cancelPaint(editor: Editor): void {
  const state = armed.get(editor);
  if (!state) return;
  armed.delete(editor);
  state.stop();
  emit();
}

/**
 * Paints the picked-up bundle onto the selection as one undo step (sets
 * marks, never toggles), then disarms. Unavailable (no text selected,
 * code): says why and stays armed.
 */
export function applyPaint(editor: Editor): boolean {
  const state = armed.get(editor);
  if (!state) return false;
  const reason = applyDisabledReason(editor.state, state.bundle);
  if (reason !== null) {
    announce(reason);
    return false;
  }
  if (!editor.commands.applyFormatBundle(state.bundle)) return false;
  cancelPaint(editor);
  announce(PAINT_PILLS.applied, { done: true });
  return true;
}

/**
 * Listeners while armed: a mouse drag or click that starts in the editor
 * and ends a non-empty selection applies (read a frame after pointer-up,
 * once ProseMirror has the selection; the drag may end outside the
 * editor). Touch never applies on its own: the handles settle many
 * times.
 */
function listen(editor: Editor): () => void {
  const wrapper = editor.view.dom.parentElement;
  wrapper?.classList.add(PAINTING_CLASS);
  let fromEditor = false;
  let frame = 0;
  const onPointerDown = (event: PointerEvent) => {
    fromEditor =
      event.pointerType === "mouse" &&
      event.target instanceof Node &&
      editor.view.dom.contains(event.target);
  };
  const onPointerUp = () => {
    if (!fromEditor) return;
    fromEditor = false;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      if (!editor.isDestroyed && !editor.state.selection.empty) {
        applyPaint(editor);
      }
    });
  };
  // Esc in the text cancels. On a toolbar item it only returns to the
  // text (the keyboard path: Alt+F10, brush, Esc, Shift+arrows, ⌘⌥V), and
  // in a menu or dialog it closes that.
  const onKeyDown = (event: KeyboardEvent) => {
    const { target } = event;
    if (
      event.key !== "Escape" ||
      (target instanceof Node &&
        target !== document.body &&
        !editor.view.dom.contains(target))
    ) {
      return;
    }
    cancelPaint(editor);
    dismissNotice();
  };
  const onUpdate = () => {
    if (!editor.isEditable) cancelPaint(editor);
  };
  const onDestroy = () => cancelPaint(editor);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("keydown", onKeyDown, true);
  editor.on("update", onUpdate);
  editor.on("destroy", onDestroy);
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
    editor.off("update", onUpdate);
    editor.off("destroy", onDestroy);
    wrapper?.classList.remove(PAINTING_CLASS);
  };
}

/**
 * Picks up the formatting at the selection or caret, the full read (plain
 * text picks up "plain", as in Docs), which also becomes the remembered
 * Repeat bundle.
 */
function arm(editor: Editor, touch: boolean): void {
  const bundle = readBundleAt(editor.state);
  rememberBundle(bundle);
  const storage = (
    editor.storage as { repeatFormatting?: RepeatFormattingStorage }
  ).repeatFormatting;
  if (storage) storage.session.range = null;
  const { from, to } = editor.state.selection;
  armed.set(editor, { bundle, from, to, stop: listen(editor) });
  emit();
  announce(`Picked up ${bundleSetLabel(bundle)}. Select text to apply.`, {
    pill: touch ? PAINT_PILLS.touch : PAINT_PILLS.pointer,
  });
}

/**
 * The brush, the palette's and ⋯'s "Paint format": arms; armed, applies
 * to a new non-empty selection, or cancels on the one it was armed on
 * (or a caret). `touch` picks the pill that says to tap the brush again.
 */
export function togglePaint(editor: Editor, touch = false): boolean {
  if (!editor.isEditable) return false;
  const state = armed.get(editor);
  if (!state) {
    arm(editor, touch);
    return true;
  }
  const { from, to, empty } = editor.state.selection;
  if (!empty && (from !== state.from || to !== state.to)) {
    return applyPaint(editor);
  }
  cancelPaint(editor);
  dismissNotice();
  return true;
}
