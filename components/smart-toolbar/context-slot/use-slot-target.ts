"use client";

import type { Editor } from "@tiptap/react";
import { type RefObject, useEffect, useSyncExternalStore } from "react";

import type { ContextKind } from "@/lib/editor-actions/types";
import { getEditorContextStore } from "@/lib/editor-context/store";

export interface SlotTarget {
  kind: ContextKind;
  /** The heading the slot acts on (held while focus is in the toolbar). */
  headingId: string | null;
}

const PARAGRAPH: SlotTarget = { kind: "paragraph", headingId: null };
const noopSubscribe = () => () => {};
const SEPARATOR = "\u0000";

const keyOf = (editor: Editor) => {
  const ctx = getEditorContextStore(editor).getSlotContext();
  return `${ctx.kind}${SEPARATOR}${ctx.headingId ?? ""}`;
};

/**
 * What the slot shows, from the held snapshot (`getSlotContext`). The
 * snapshot is a string, so a caret move inside one paragraph or heading
 * never re-renders the slot.
 */
export function useSlotTarget(editor: Editor | null): SlotTarget {
  const store = editor ? getEditorContextStore(editor) : null;
  const key = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => (editor ? keyOf(editor) : ""),
    () => "",
  );
  if (!key) return PARAGRAPH;
  const [kind, headingId] = key.split(SEPARATOR);
  return { kind: kind as ContextKind, headingId: headingId || null };
}

/** Focus inside a toolbar popup (portaled menu) counts as in the toolbar. */
const POPUP_SELECTOR = "[data-toolbar-popup]";

/**
 * Holds the slot's contents while focus is anywhere in the toolbar or its
 * popups (spec §4.2), so a collaborator's edit never swaps the control under
 * focus. Released when focus leaves, and always on unmount (`focusout` is not
 * guaranteed, spec §7).
 */
export function useToolbarHold(
  editor: Editor | null,
  anchorRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    const toolbar = anchorRef.current?.closest<HTMLElement>('[role="toolbar"]');
    if (!editor || !toolbar) return;
    const store = getEditorContextStore(editor);
    let release: (() => void) | null = null;
    const inside = (node: EventTarget | null) =>
      node instanceof Element &&
      (toolbar.contains(node) || node.closest(POPUP_SELECTOR) !== null);

    const onFocusIn = () => {
      release ??= store.hold();
    };
    const onFocusOut = (event: FocusEvent) => {
      if (inside(event.relatedTarget)) return;
      // Focus may be moving into a portaled popup that mounts a tick later.
      queueMicrotask(() => {
        if (inside(document.activeElement)) return;
        release?.();
        release = null;
      });
    };
    const onDocumentFocusIn = (event: FocusEvent) => {
      if (release && !inside(event.target)) {
        release();
        release = null;
      }
    };
    toolbar.addEventListener("focusin", onFocusIn);
    toolbar.addEventListener("focusout", onFocusOut);
    document.addEventListener("focusin", onDocumentFocusIn);
    if (inside(document.activeElement)) onFocusIn();
    return () => {
      toolbar.removeEventListener("focusin", onFocusIn);
      toolbar.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("focusin", onDocumentFocusIn);
      release?.();
      release = null;
    };
  }, [editor, anchorRef]);
}
