"use client";

import { TextSelection } from "@tiptap/pm/state";
import type { Editor, EditorEvents } from "@tiptap/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { getSlashState } from "@/extensions/slash-trigger/slash-trigger";
import { PlusIcon } from "@/lib/icons";

/*
 * The `+` on an empty line (spec §8.2, O5 a). It lives in the slash folder
 * but is mounted by the lazy bubble chunk's desktop wrapper
 * (`SelectionBubbleView`), so it depends on that chunk having loaded and
 * the editor chunk carries none of it (0 B ruling). A click types the "/"
 * for the writer, outside the undo history, so the ordinary "/" menu
 * opens: one code path. No plugin: it follows the editor's events and the
 * pointer, positions itself with `coordsAtPos`, and sets no React state
 * per transaction.
 *
 * It must not import the slash menu statically: `plus-origin`'s record
 * would then have a second copy in this chunk. It loads it with
 * `import("./slash-menu")`, the same module the "/" host loads.
 */

/** The caret's empty line shows it this long after the last keystroke. */
const TYPING_DELAY_MS = 300;
/** The pointer rests this long on an empty line before it shows. */
const HOVER_DWELL_MS = 150;
/** 28 px square; centred on the heading grip's column (20 px, 4 px out). */
const SIZE = 28;
const FINE_POINTER = "(hover: hover) and (pointer: fine)";
const PASSIVE = { passive: true } as const;

/**
 * The position of `dom`, a top-level child of the editor, if it is an
 * empty paragraph; derived from the DOM each time, so it never goes stale
 * through a collaborator's edit.
 */
function emptyLineAt(editor: Editor, dom: Element | null): number | null {
  const { view } = editor;
  if (!(dom instanceof HTMLParagraphElement) || dom.parentElement !== view.dom)
    return null;
  const pos = view.posAtDOM(dom, 0) - 1;
  const node = pos >= 0 ? editor.state.doc.nodeAt(pos) : null;
  return node?.type.name === "paragraph" && node.content.size === 0
    ? pos
    : null;
}

/** The caret's line, if it is an empty paragraph at the top level. */
function caretLine(editor: Editor): Element | null {
  const { selection } = editor.state;
  const { $head } = selection;
  if (!selection.empty || $head.depth !== 1) return null;
  if ($head.parent.type.name !== "paragraph" || $head.parent.content.size)
    return null;
  const dom = editor.view.nodeDOM($head.before());
  return dom instanceof Element ? dom : null;
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
  const shown = useRef<Element | null>(null);

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
    let reading = 0;
    /** The line the pointer rests on (after the dwell), and the candidate. */
    let hovered: Element | null = null;
    let pending: Element | null = null;
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
      const caret = settled && editor.isFocused ? caretLine(editor) : null;
      const line = emptyLineAt(editor, hovered) !== null ? hovered : caret;
      const pos = emptyLineAt(editor, line);
      if (!(line instanceof HTMLElement) || pos === null) {
        hide();
        return;
      }
      const at = view.coordsAtPos(pos + 1);
      const block = line.getBoundingClientRect();
      const origin = host.getBoundingClientRect();
      const rtl = getComputedStyle(line).direction === "rtl";
      const x = rtl ? block.right : block.left - SIZE;
      const y = (at.top + at.bottom - SIZE) / 2;
      el.style.left = `${x - origin.left + host.scrollLeft - host.clientLeft}px`;
      el.style.top = `${y - origin.top + host.scrollTop - host.clientTop}px`;
      el.style.display = "";
      shown.current = line;
    };
    const schedule = () => {
      frame ||= requestAnimationFrame(render);
    };
    // Typing in a line with text costs one check: nothing shown, nothing
    // hovered, and the caret's line is not empty.
    const onTransaction = ({ transaction }: EditorEvents["transaction"]) => {
      if (!transaction.docChanged && !transaction.selectionSet) return;
      if (shown.current || hovered || caretLine(editor)) schedule();
    };

    const onKey = () => {
      settled = false;
      if (!hovered) hide();
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
    const pointed = (): Element | null => {
      if (target instanceof Node && el.contains(target)) return shown.current;
      let node = target instanceof Element ? target : null;
      while (node && node.parentElement !== view.dom) node = node.parentElement;
      return emptyLineAt(editor, node) === null ? null : node;
    };
    const readPointer = () => {
      reading = 0;
      const line = pointed();
      if (line === pending) return;
      pending = line;
      clearTimeout(dwell);
      if (!line) {
        if (hovered) {
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
    scrollTarget.addEventListener("mousemove", onPointerMove, PASSIVE);
    scrollTarget.addEventListener("mouseleave", onPointerLeave, PASSIVE);
    window.addEventListener("resize", schedule, PASSIVE);
    editor.on("transaction", onTransaction);
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
      editor.off("transaction", onTransaction);
      editor.off("focus", schedule);
      editor.off("blur", schedule);
      editor.off("update", schedule);
    };
  }, [editor, host, scrollTarget]);

  /**
   * Types the "/" into the line, outside the history, so the menu opens;
   * then marks that "/" as the `+`'s. The slash chunk is loaded on idle,
   * so the import is normally settled already.
   */
  const insert = async () => {
    const line = shown.current;
    const slash = await import("./slash-menu").catch(() => null);
    const pos = emptyLineAt(editor, line);
    if (!slash || pos === null || editor.isDestroyed) return;
    const view = editor.view;
    // The hover path may find the editor blurred; a blur closes the menu.
    view.focus();
    const { tr } = view.state;
    view.dispatch(
      tr
        .setSelection(TextSelection.create(tr.doc, pos + 1))
        .insertText("/")
        .setMeta("addToHistory", false),
    );
    slash.markPlusSlash(editor);
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
