"use client";

/**
 * The Paint format brush pressed before the lazy engine has landed. Other
 * early runs wait for the engine and run only if the selection has not
 * moved (`runWithEngine`), but for the brush the next move is the point:
 * the user presses it, then selects the text to paint. So the press is
 * kept here, shown at once like the armed state (pressed brush, copy
 * cursor, pill), and the picked-up range follows edits (Yjs relative
 * positions in a collaborative editor). Once the engine lands it arms on
 * that range and, if a mouse selection of other text ended meanwhile or
 * the brush was pressed again on one (touch), paints it.
 *
 * Only the brushes import this (lazy surface chunks), never the engine,
 * and its listeners exist only while a press is pending.
 */
import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";
import { useCallback, useSyncExternalStore } from "react";

import {
  fromSessionRange,
  mapSessionRange,
  type SessionRange,
  toSessionRange,
} from "@/extensions/repeat-formatting/relative-range";
import { announce, dismissNotice } from "@/lib/announce";
import {
  PAINT_PILLS,
  PAINTING_CLASS,
} from "@/lib/editor-actions/paint-format-ui";
import {
  ENGINE_LOAD_FAILED,
  getV11Engine,
  loadV11Engine,
} from "@/lib/editor-actions/v11-actions";
import { useV11EngineReady } from "@/lib/editor-actions/v11-engine-ready";

/** The text the brush was pressed on. */
interface Pressed {
  source: SessionRange;
  /**
   * 1 when the press was on text: the start is kept one character in, on
   * the first character (a relative position sticks to the character on
   * its left), so text typed right before the pressed text stays out.
   */
  inset: number;
}

interface Pending extends Pressed {
  touch: boolean;
  /**
   * Paint the selection on landing if it is other text: a mouse selection
   * ended, or the brush was pressed again on new text (touch).
   */
  apply: boolean;
  /** A mouse button that went down in the text is still down. */
  dragging: boolean;
  /** The engine landed mid-drag: land at its pointer-up. */
  landOnUp: boolean;
  stop: () => void;
}

const pending = new WeakMap<Editor, Pending>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/** Whether the brush was pressed on `editor` and waits for the engine. */
export const isPaintPending = (editor: Editor): boolean => pending.has(editor);

function subscribePending(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Whether the brush shows pressed: Paint format armed, or pressed before
 * the engine landed. Re-renders when either changes.
 */
export function usePainting(editor: Editor): boolean {
  const ready = useV11EngineReady();
  // A new subscribe once the engine lands, so its store is subscribed.
  const subscribe = useCallback(
    (listener: () => void) => {
      const stopPending = subscribePending(listener);
      const stopPaint = ready
        ? getV11Engine()?.paint.subscribe(listener)
        : undefined;
      return () => {
        stopPending();
        stopPaint?.();
      };
    },
    [ready],
  );
  return useSyncExternalStore(
    subscribe,
    () =>
      isPaintPending(editor) ||
      (getV11Engine()?.paint.isPainting(editor) ?? false),
    () => false,
  );
}

/** Drops the press without a word or an emit; returns it. */
function clear(editor: Editor): Pending | undefined {
  const entry = pending.get(editor);
  if (!entry) return undefined;
  pending.delete(editor);
  entry.stop();
  return entry;
}

function cancel(editor: Editor): void {
  if (!clear(editor)) return;
  dismissNotice();
  emit();
}

function press(editor: Editor): Pressed {
  const { state } = editor;
  const { from, to } = state.selection;
  const inset = from < to ? 1 : 0;
  return {
    source: toSessionRange(state, { anchor: from + inset, head: to }),
    inset,
  };
}

/** The pressed text now, or null once it is gone. */
function pressedRange(
  editor: Editor,
  { source, inset }: Pressed,
): { from: number; to: number } | null {
  const range = fromSessionRange(editor.state, source);
  if (!range) return null;
  const from = Math.min(range.anchor, range.head) - inset;
  const to = Math.max(range.anchor, range.head);
  return from >= 0 && from <= to ? { from, to } : null;
}

/** Whether the selection is other text: neither a caret nor the source. */
function onOtherText(editor: Editor, entry: Pending): boolean {
  const { selection } = editor.state;
  const range = pressedRange(editor, entry);
  return (
    !selection.empty &&
    !(range && range.from === selection.from && range.to === selection.to)
  );
}

/** Arms on the source (gone: drops quietly), then paints if asked. */
function land(editor: Editor, entry: Pending): void {
  if (pending.get(editor) !== entry) return;
  if (entry.dragging) {
    entry.landOnUp = true;
    return;
  }
  const paint = getV11Engine()?.paint;
  const range = pressedRange(editor, entry);
  const apply = entry.apply && onOtherText(editor, entry);
  clear(editor);
  if (!paint || !range || paint.isPainting(editor)) {
    dismissNotice();
  } else if (paint.toggle(editor, entry.touch, range) && apply) {
    paint.toggle(editor);
  }
  emit();
}

/** Mirrors the armed listeners (`paint-format.ts`) while the press waits. */
function listen(editor: Editor, entry: Pending): () => void {
  const wrapper = editor.view.dom.parentElement;
  wrapper?.classList.add(PAINTING_CLASS);
  let frame = 0;
  const onPointerDown = (event: PointerEvent) => {
    entry.dragging =
      event.pointerType === "mouse" &&
      event.target instanceof Node &&
      editor.view.dom.contains(event.target);
  };
  const onPointerUp = () => {
    if (!entry.dragging) return;
    entry.dragging = false;
    entry.apply = true;
    if (!entry.landOnUp) return;
    // A frame later, once ProseMirror has the selection.
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => land(editor, entry));
  };
  // Esc in the text cancels; on a toolbar item or in a menu it is theirs.
  const onKeyDown = (event: KeyboardEvent) => {
    const { target } = event;
    if (
      event.key === "Escape" &&
      (!(target instanceof Node) ||
        target === document.body ||
        editor.view.dom.contains(target))
    ) {
      cancel(editor);
    }
  };
  const onTransaction = ({ transaction }: { transaction: Transaction }) => {
    entry.source = mapSessionRange(entry.source, transaction);
  };
  const onUpdate = () => {
    if (!editor.isEditable) cancel(editor);
  };
  const onDestroy = () => cancel(editor);
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("pointerup", onPointerUp, true);
  document.addEventListener("keydown", onKeyDown, true);
  editor.on("transaction", onTransaction);
  editor.on("update", onUpdate);
  editor.on("destroy", onDestroy);
  return () => {
    cancelAnimationFrame(frame);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("pointerup", onPointerUp, true);
    document.removeEventListener("keydown", onKeyDown, true);
    editor.off("transaction", onTransaction);
    editor.off("update", onUpdate);
    editor.off("destroy", onDestroy);
    wrapper?.classList.remove(PAINTING_CLASS);
  };
}

/** Keeps a press until the engine lands (or fails to). */
function wait(editor: Editor, pressed: Pressed, touch: boolean): void {
  const entry: Pending = {
    ...pressed,
    touch,
    apply: false,
    dragging: false,
    landOnUp: false,
    stop: () => undefined,
  };
  entry.stop = listen(editor, entry);
  pending.set(editor, entry);
  emit();
  announce("Paint format on. Select text to apply.", {
    pill: touch ? PAINT_PILLS.touch : PAINT_PILLS.pointer,
  });
  loadV11Engine().then(
    () => land(editor, entry),
    () => {
      if (pending.get(editor) !== entry) return;
      cancel(editor);
      // Retry presses again on the same text (§5).
      announce(ENGINE_LOAD_FAILED, {
        action: {
          label: "Retry",
          run: () => {
            if (!editor.isDestroyed && !pending.has(editor)) {
              wait(editor, entry, touch);
            }
          },
        },
      });
    },
  );
}

/**
 * A press on the brush. With the engine in: Paint format's toggle. Before
 * it lands: presses (a second press on the same text or a caret
 * cancels; on other text it paints that text once the engine lands).
 */
export function pressBrush(editor: Editor, touch: boolean): void {
  const entry = pending.get(editor);
  const paint = getV11Engine()?.paint;
  if (entry) {
    if (onOtherText(editor, entry)) entry.apply = true;
    else cancel(editor);
  } else if (paint) {
    paint.toggle(editor, touch);
  } else if (editor.isEditable) {
    wait(editor, press(editor), touch);
  }
}
