"use client";

import type { Editor } from "@tiptap/react";
import {
  type CSSProperties,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { lazySurface } from "@/components/smart-toolbar/lazy-surface";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { onUiIntent } from "@/lib/editor-actions/ui-intents";
import { PlusIcon } from "@/lib/icons";

import type { InsertSheetStep as Step } from "./insert-sheet-body";

/**
 * The sheet's body (its cells and steps): its own chunk (spec §8.3).
 * Fetched when the browser is idle after the bar mounts and again on the
 * Insert cell's press, so the sheet opens with its cells in place; a
 * failed fetch says so in the sheet, with Retry.
 */
const loadInsertSheetBody = () => import("./insert-sheet-body");
const preloadInsertSheetBody = () => {
  loadInsertSheetBody().catch(() => undefined);
};
const InsertSheetBody = lazySurface(
  () => loadInsertSheetBody().then((module) => module.InsertSheetBody),
  undefined,
  "the insert sheet",
);

/** Runs `run` when the browser is idle (Safari has no idle callback). */
function whenIdle(run: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: 4000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(run, 1500);
  return () => window.clearTimeout(id);
}

/**
 * With the keyboard up, where the sheet may go: its bottom on the
 * keyboard, its top inside the visual viewport, which iOS can pan down the
 * layout viewport (`offsetTop`) while the keyboard is up.
 */
function keyboardStyle(inset: number): CSSProperties | undefined {
  if (!inset) return undefined;
  const visible = window.visualViewport?.height ?? window.innerHeight - inset;
  return {
    "--keyboard-inset": `${inset}px`,
    "--visible-height": `${visible}px`,
  } as CSSProperties;
}

export interface InsertSheetProps {
  editor: Editor;
  open: boolean;
  /** The bar makes the page inert while it is open, as for the Aa sheet. */
  onOpenChange: (open: boolean) => void;
  /** Render the bar's Insert cell (not while the selection cells show). */
  cell: boolean;
  /**
   * The on-screen keyboard's height (the bar's `useKeyboardInset`): the
   * embed step's link field raises it, and the sheet rides above it.
   */
  keyboardInset: number;
}

/**
 * The phone Insert sheet (spec §8.3, O6 a): the bar's Insert cell opens a
 * bottom sheet of the "/" menu's items as a two-column grid of 44px cells
 * (`insert-sheet-items.ts`). Picking closes it and hands focus back to the
 * editor, so the keyboard returns with the caret in the new block. Table
 * and embed open their step inside the sheet, from the lazy insert step
 * chunk; Diagram ▸ lists the templates. It also answers `insert.open`
 * (a "/" or palette pick of Table or Embed), opening at that step, which
 * the row's Insert menu does on desktop. Done, a swipe down and the scrim
 * close it. Part of the phone bar's lazy chunk (contract A9).
 */
export function InsertSheet({
  editor,
  open,
  onOpenChange,
  cell,
  keyboardInset,
}: InsertSheetProps) {
  const [step, setStep] = useState<Step | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  /** Set by a pick: focus goes to the editor, not back to the cell. */
  const pickedRef = useRef(false);

  useEffect(() => whenIdle(preloadInsertSheetBody), []);

  useEffect(() => {
    let frame = 0;
    const off = onUiIntent(editor, (intent) => {
      if (intent.type !== "insert.open") return false;
      if (intent.kind !== "table" && intent.kind !== "embed") return false;
      if (!editor.isEditable) return false;
      const kind = intent.kind;
      // Let the "/" menu or the palette close first. Cancelled on unmount,
      // so it never makes the page inert after the bar has gone.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        setStep(kind);
        pickedRef.current = false;
        onOpenChange(true);
      });
      return true;
    });
    return () => {
      off();
      cancelAnimationFrame(frame);
    };
  }, [editor, onOpenChange]);

  // The keyboard came up (or moved): keep the focused field in view in
  // the shortened sheet.
  useEffect(() => {
    if (!open || !keyboardInset) return;
    const active = document.activeElement;
    if (
      active instanceof HTMLElement &&
      active.closest("[data-insert-sheet]")
    ) {
      active.scrollIntoView({ block: "nearest" });
    }
  }, [open, keyboardInset]);

  /**
   * After a pick: closes (which lifts the page's `inert`) and focuses the
   * editor at once, inside the tap, so a phone raises its keyboard again
   * (iOS only does so from a user gesture). `view.focus()` puts the DOM
   * caret where the pick left the selection; a bare `focus()` would read
   * the stale DOM selection back instead.
   */
  const onDone = useCallback(() => {
    pickedRef.current = true;
    onOpenChange(false);
    if (editor.isDestroyed) return;
    editor.view.focus();
    editor.view.dispatch(editor.state.tr.scrollIntoView());
  }, [editor, onOpenChange]);

  /**
   * The first cell (Suggested's when present, spec §14); a step's own
   * control (the embed field, the table grid) focuses itself. Until the
   * body is in, the default; the body then focuses its first cell.
   */
  const initialFocus = useCallback(
    () =>
      popupRef.current?.querySelector<HTMLElement>(
        "[data-insert-step] :is(input, .st-table-cell[tabindex='0']), .st-insert-cell",
      ) ?? true,
    [],
  );

  /** Back to the Insert cell, unless a pick has focused the editor. */
  const finalFocus = useCallback(() => {
    if (!pickedRef.current) return triggerRef.current ?? true;
    pickedRef.current = false;
    return false;
  }, []);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) pickedRef.current = false;
        onOpenChange(next);
      }}
      onOpenChangeComplete={(next) => {
        if (!next) setStep(null);
      }}
    >
      {cell ? (
        <SheetTrigger
          render={
            <ToolbarButton
              ref={triggerRef}
              type="button"
              data-surface="phone"
              aria-label="Insert"
              tooltip="Insert"
              aria-haspopup="dialog"
              onPointerDown={preloadInsertSheetBody}
              onFocus={preloadInsertSheetBody}
            />
          }
        >
          <PlusIcon aria-hidden="true" />
        </SheetTrigger>
      ) : null}
      <SheetContent
        ref={popupRef}
        data-insert-sheet=""
        data-toolbar-popup=""
        data-keyboard={keyboardInset ? "" : undefined}
        initialFocus={initialFocus}
        finalFocus={finalFocus}
        className="st-insert-sheet max-h-[75dvh]"
        style={keyboardStyle(keyboardInset)}
      >
        <SheetHeader>
          <SheetTitle className="flex-1">Insert</SheetTitle>
          <SheetClose
            render={<ToolbarButton type="button" className="st-sheet-done" />}
          >
            Done
          </SheetClose>
        </SheetHeader>
        <InsertSheetBody
          editor={editor}
          step={step}
          onStep={setStep}
          onDone={onDone}
        />
      </SheetContent>
    </Sheet>
  );
}
