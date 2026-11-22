"use client";

import { TextSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getSlashState } from "@/extensions/slash-trigger/slash-trigger";
import { PlusIcon } from "@/lib/icons";

/*
 * The `+` on an empty line (spec §8.2, O5 a). It lives in the slash folder
 * and mounts from the lazy bubble chunk's desktop wrapper, so the editor
 * chunk carries none of it (head-of-engineering ruling: 0 B). A click
 * types the "/" for the writer, outside the undo history, so the ordinary
 * "/" menu opens: one code path. No plugin: it follows the editor's
 * events and the pointer, positions itself with `coordsAtPos`, and
 * changes no React state per transaction.
 */

/** The caret's empty line shows it this long after the last keystroke. */
const TYPING_DELAY_MS = 300;
/** The pointer rests this long on an empty line before it shows. */
const HOVER_DWELL_MS = 150;
/** 28 px square; centred on the heading grip's column (20 px, 4 px out). */
const SIZE = 28;
const FINE_POINTER = "(hover: hover) and (pointer: fine)";

/** The "/" the `+` typed, until the menu it opened closes. */
let plusSlash: { editor: Editor; from: number } | null = null;

/** Whether the `+` typed the "/" at `from` (read once by the menu). */
export const typedByPlus = (editor: Editor, from: number): boolean =>
  plusSlash?.editor === editor && plusSlash.from === from;

/** The menu that `+` opened has closed. */
export const clearPlusSlash = (): void => {
  plusSlash = null;
};

/** Pos of the top-level empty paragraph at `pos`, else null. */
function emptyLine(editor: Editor, pos: number | null): number | null {
  if (pos === null || pos < 0) return null;
  const { doc } = editor.state;
  if (pos >= doc.content.size) return null;
  const node = doc.nodeAt(pos);
  return node?.type.name === "paragraph" &&
    node.content.size === 0 &&
    doc.resolve(pos).depth === 0
    ? pos
    : null;
}

/** The caret's line, if it is an empty paragraph at the top level. */
function caretLine(editor: Editor): number | null {
  const { selection } = editor.state;
  const { $head } = selection;
  return selection.empty && $head.depth === 1
    ? emptyLine(editor, $head.before())
    : null;
}

function useFinePointer(): boolean {
  const [fine, setFine] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(FINE_POINTER);
    const update = () => setFine(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return fine;
}

/**
 * Shows on a fine pointer while the caret is in an empty top-level
 * paragraph (so never the title, a list item, a quote or a table cell),
 * 300 ms after the last keystroke, and on an empty paragraph the pointer
 * rests on for 150 ms; hidden during IME composition, while the "/" menu
 * is open and in a read-only editor. Not in the Tab order: keys have "/"
 * and Alt+/.
 */
export function EmptyLinePlus({
  editor,
  scrollTarget,
}: {
  editor: Editor;
  /** `.document-editor-wrapper`: hovering anywhere in it is watched. */
  scrollTarget: HTMLElement;
}) {
  const fine = useFinePointer();
  const [host, setHost] = useState<HTMLElement | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  /** The line the `+` is shown beside, or null. */
  const shown = useRef<number | null>(null);

  useEffect(() => {
    if (!fine || editor.isDestroyed) return;
    // Heading drag makes it `position: relative`; the `+` scrolls with it.
    setHost(editor.view.dom.parentElement);
    return () => setHost(null);
  }, [editor, fine]);

  useEffect(() => {
    const el = button.current;
    if (!host || !el) return;
    const view = editor.view;
    let settled = true;
    let composing = view.composing;
    let typing = 0;
    let dwell = 0;
    let frame = 0;
    /** The line the pointer rests on (after the dwell), and the candidate. */
    let hovered: number | null = null;
    let pending: number | null = null;
    let target: EventTarget | null = null;

    const hide = () => {
      shown.current = null;
      el.style.display = "none";
    };

    const render = () => {
      frame = 0;
      if (
        editor.isDestroyed ||
        !editor.isEditable ||
        composing ||
        getSlashState(editor).open
      ) {
        hide();
        return;
      }
      const line =
        emptyLine(editor, hovered) ??
        (settled && editor.isFocused ? caretLine(editor) : null);
      const dom = line === null ? null : view.nodeDOM(line);
      if (line === null || !(dom instanceof HTMLElement)) {
        hide();
        return;
      }
      const caret = view.coordsAtPos(line + 1);
      const block = dom.getBoundingClientRect();
      const origin = host.getBoundingClientRect();
      const rtl = getComputedStyle(dom).direction === "rtl";
      const x = rtl ? block.right : block.left - SIZE;
      const y = (caret.top + caret.bottom - SIZE) / 2;
      el.style.left = `${x - origin.left + host.scrollLeft - host.clientLeft}px`;
      el.style.top = `${y - origin.top + host.scrollTop - host.clientTop}px`;
      el.style.display = "";
      shown.current = line;
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(render);
    };

    const onKey = () => {
      settled = false;
      if (hovered === null) hide();
      clearTimeout(typing);
      typing = window.setTimeout(() => {
        settled = true;
        schedule();
      }, TYPING_DELAY_MS);
    };
    const onCompositionStart = () => {
      composing = true;
      hide();
    };
    const onCompositionEnd = () => {
      composing = false;
      schedule();
    };

    /** The empty top-level line under the pointer (read once per frame). */
    const pointed = (): number | null => {
      if (target instanceof Node && el.contains(target)) return shown.current;
      let node = target instanceof Element ? target : null;
      while (node && node.parentElement !== view.dom) node = node.parentElement;
      if (!(node instanceof HTMLParagraphElement)) return null;
      return emptyLine(editor, view.posAtDOM(node, 0) - 1);
    };
    let reading = 0;
    const readPointer = () => {
      reading = 0;
      const line = pointed();
      if (line === pending) return;
      pending = line;
      clearTimeout(dwell);
      if (line === null) {
        if (hovered !== null) {
          hovered = null;
          schedule();
        }
        return;
      }
      dwell = window.setTimeout(() => {
        hovered = line;
        schedule();
      }, HOVER_DWELL_MS);
    };
    const onPointerMove = (event: MouseEvent) => {
      target = event.target;
      reading ||= requestAnimationFrame(readPointer);
    };
    const onPointerLeave = () => {
      target = null;
      reading ||= requestAnimationFrame(readPointer);
    };

    const dom = view.dom;
    dom.addEventListener("keydown", onKey);
    dom.addEventListener("compositionstart", onCompositionStart);
    dom.addEventListener("compositionend", onCompositionEnd);
    scrollTarget.addEventListener("mousemove", onPointerMove);
    scrollTarget.addEventListener("mouseleave", onPointerLeave);
    window.addEventListener("resize", schedule);
    editor.on("transaction", schedule);
    editor.on("focus", schedule);
    editor.on("blur", schedule);
    editor.on("update", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(reading);
      clearTimeout(typing);
      clearTimeout(dwell);
      dom.removeEventListener("keydown", onKey);
      dom.removeEventListener("compositionstart", onCompositionStart);
      dom.removeEventListener("compositionend", onCompositionEnd);
      scrollTarget.removeEventListener("mousemove", onPointerMove);
      scrollTarget.removeEventListener("mouseleave", onPointerLeave);
      window.removeEventListener("resize", schedule);
      editor.off("transaction", schedule);
      editor.off("focus", schedule);
      editor.off("blur", schedule);
      editor.off("update", schedule);
    };
  }, [editor, host, scrollTarget]);

  /** Types the "/" into the line, outside the history: the menu opens. */
  const insert = () => {
    const view = editor.view;
    const line = emptyLine(editor, shown.current);
    if (line === null) return;
    // The hover path may find the editor blurred; a blur closes the menu.
    view.focus();
    plusSlash = { editor, from: line + 1 };
    const { tr } = view.state;
    view.dispatch(
      tr
        .setSelection(TextSelection.create(tr.doc, line + 1))
        .insertText("/")
        .setMeta("addToHistory", false),
    );
    if (!getSlashState(editor).open) plusSlash = null;
  };

  if (!fine || !host) return null;
  return createPortal(
    <button
      ref={button}
      type="button"
      data-empty-line-plus=""
      aria-label="Insert block"
      aria-haspopup="listbox"
      title="Insert block · or type /"
      tabIndex={-1}
      className="absolute z-20 flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      style={{ display: "none" }}
      // The editor keeps focus (and its caret); the trigger sees no blur.
      onMouseDown={(event) => event.preventDefault()}
      onClick={insert}
    >
      <PlusIcon aria-hidden="true" className="size-4" />
    </button>,
    host,
  );
}
