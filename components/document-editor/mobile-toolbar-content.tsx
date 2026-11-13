"use client";

import type { Editor } from "@tiptap/react";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { ActionButton } from "@/components/smart-toolbar/action-button";
import { FormatSheetBody } from "@/components/smart-toolbar/phone/format-sheet";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Toolbar } from "@/components/ui/toolbar";
import { ToolbarButton } from "@/components/ui/toolbar-button";
import { useActionView } from "@/hooks/use-editor-context";
import { useKeyboardInset } from "@/hooks/use-keyboard-inset";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";
import { setMobileBarClearance } from "@/lib/editor-scroll-clearance";
import {
  RECENT_COLORS_CHOICE,
  useRememberedChoice,
} from "@/lib/remembered-choice";
import "@/components/smart-toolbar/phone/phone.scss";

/** The bar's constant height (spec §4.7). */
export const MOBILE_BAR_HEIGHT = 44;

/**
 * While the sheet is open the page behind it is `inert` (the sheet is
 * portalled to `body`, outside it): Tab and screen readers stay in the
 * sheet, and the registry actions' `editor.chain().focus()` cannot pull
 * focus out of it (on a phone that would raise the keyboard over it).
 * Commands still apply.
 */
function setPageInert(editor: Editor | null, inert: boolean) {
  if (!editor || editor.isDestroyed) return;
  const dom = editor.view.dom as HTMLElement;
  const page = dom.closest<HTMLElement>(".app-shell") ?? dom;
  page.inert = inert;
}

/**
 * Something focusable in the document after the bar hides: the editor, or
 * (read-only, so not focusable) its region, made programmatically
 * focusable without joining the Tab order.
 */
function documentFocusTarget(editor: Editor): HTMLElement {
  const dom = editor.view.dom as HTMLElement;
  if (editor.isEditable) return dom;
  const region = dom.closest<HTMLElement>(".document-editor-content") ?? dom;
  if (!region.hasAttribute("tabindex")) region.tabIndex = -1;
  return region;
}

interface MobileToolbarContentProps {
  editor: Editor | null;
  ref?: Ref<HTMLDivElement>;
  /** Esc on a cell: back to the document with its selection. */
  onEscape?: () => void;
  /**
   * The last cells (List ▾, Indent, Insert ▾: `PhoneMenuCells`), rendered
   * by the editor shell so the row's menus stay in the editor chunk.
   */
  menuCells: ReactNode;
}

/**
 * The phone bar (< 768px, spec §4.7): one `role="toolbar"`, a constant
 * 44px tall, docked above the on-screen keyboard. Cells of at least 44×44:
 * undo, redo (360px and up; the sheet carries it below), Aa (the "Text
 * format" sheet: style, size, colours, align, more), B, I, then
 * `menuCells` (list, indent, Insert). Toggles show their state with `aria-pressed`
 * (#269). Hidden in a read-only document (#308), which also closes the
 * sheet. Follow-ups: the context slot cell, and the selection swap
 * (`PhoneSelectionCells`, PR E). Its own lazy chunk with the sheet, loaded
 * only below 768px (contract A9).
 */
export function MobileToolbarContent({
  editor,
  ref,
  onEscape,
  menuCells,
}: MobileToolbarContentProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const recent = useRememberedChoice(RECENT_COLORS_CHOICE);
  const inset = useKeyboardInset();
  const bold = useActionView("mark.bold", editor);
  const readOnly =
    bold !== null &&
    bold.enabled !== true &&
    bold.enabled.reason === READ_ONLY_REASON;
  const barRef = useRef<HTMLDivElement>(null);

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      barRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // ProseMirror and CSS keep the caret clear of the bar and the keyboard.
  useLayoutEffect(() => {
    const clearance = readOnly ? 0 : MOBILE_BAR_HEIGHT + inset;
    setMobileBarClearance(clearance);
    const wrapper = barRef.current?.closest<HTMLElement>(
      ".document-editor-wrapper",
    );
    wrapper?.style.setProperty("--mobile-bar-clearance", `${clearance}px`);
    wrapper?.style.setProperty("--mobile-bar-inset", `${inset}px`);
  }, [inset, readOnly]);

  useEffect(
    () => () => {
      setMobileBarClearance(0);
      const wrapper = document.querySelector<HTMLElement>(
        ".document-editor-wrapper",
      );
      wrapper?.style.removeProperty("--mobile-bar-clearance");
      wrapper?.style.removeProperty("--mobile-bar-inset");
    },
    [],
  );

  const onSheetOpenChange = useCallback(
    (open: boolean) => {
      setPageInert(editor, open);
      setSheetOpen(open);
    },
    [editor],
  );

  const closeSheet = useCallback(
    () => onSheetOpenChange(false),
    [onSheetOpenChange],
  );

  useEffect(() => {
    if (readOnly) onSheetOpenChange(false);
  }, [readOnly, onSheetOpenChange]);

  useEffect(() => () => setPageInert(editor, false), [editor]);

  /** Back to Aa, or to the document when the bar just hid. */
  const finalFocus = useCallback(() => {
    if (!readOnly || !editor) return true;
    return documentFocusTarget(editor);
  }, [readOnly, editor]);

  if (!editor) return null;

  return (
    <Toolbar
      ref={setRefs}
      variant="docked"
      aria-label="Formatting"
      data-mobile-bar=""
      hidden={readOnly}
      onEscape={onEscape}
      style={{ transform: inset ? `translateY(-${inset}px)` : undefined }}
    >
      <ActionButton id="history.undo" editor={editor} variant="phone" />
      <ActionButton id="history.redo" editor={editor} variant="phone" />
      <Sheet open={sheetOpen} onOpenChange={onSheetOpenChange}>
        <SheetTrigger
          render={
            <ToolbarButton
              type="button"
              data-surface="phone"
              className="st-phone-aa"
              aria-label="Text format"
              tooltip="Text format"
              aria-haspopup="dialog"
            />
          }
        >
          <span aria-hidden="true">Aa</span>
        </SheetTrigger>
        <SheetContent
          data-format-sheet=""
          data-toolbar-popup=""
          finalFocus={finalFocus}
          className="st-format-sheet max-h-[60dvh]"
        >
          <SheetHeader>
            <SheetTitle className="flex-1">Text format</SheetTitle>
            <SheetClose
              render={<ToolbarButton type="button" className="st-sheet-done" />}
            >
              Done
            </SheetClose>
          </SheetHeader>
          <FormatSheetBody
            editor={editor}
            recent={recent.recent}
            onClose={closeSheet}
          />
        </SheetContent>
      </Sheet>
      <ActionButton id="mark.bold" editor={editor} variant="phone" />
      <ActionButton id="mark.italic" editor={editor} variant="phone" />
      {menuCells}
    </Toolbar>
  );
}
