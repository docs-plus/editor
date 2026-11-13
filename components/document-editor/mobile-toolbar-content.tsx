"use client";

import type { Editor } from "@tiptap/react";
import {
  lazy,
  type Ref,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { ActionButton } from "@/components/smart-toolbar/action-button";
import { InsertMenu } from "@/components/smart-toolbar/insert-menu";
import {
  ActionMenuItem,
  ToolbarMenu,
  useMenuFocus,
} from "@/components/smart-toolbar/row/action-menu";
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
import { ListIcon } from "@/lib/icons";
import {
  RECENT_COLORS_CHOICE,
  useRememberedChoice,
} from "@/lib/remembered-choice";
import "@/components/smart-toolbar/smart-toolbar.scss";

/** The bar's constant height (spec §4.7). */
export const MOBILE_BAR_HEIGHT = 44;

/** Sheet body: its own chunk, fetched on first touch or focus of Aa. */
const loadFormatSheet = () =>
  import("@/components/smart-toolbar/phone/format-sheet");
const FormatSheetBody = lazy(() =>
  loadFormatSheet().then((module) => ({ default: module.FormatSheetBody })),
);

const LIST_IDS = ["list.bullet", "list.ordered", "list.task"];

/** List ▾ as one cell: the registry's list toggles in a menu. */
function ListCell({ editor }: { editor: Editor }) {
  const menu = useMenuFocus(editor);
  return (
    <ToolbarMenu
      label="List"
      tooltip="List"
      readOnly={false}
      icon={<ListIcon aria-hidden="true" />}
      showLabel={false}
      open={menu.open}
      onOpenChange={menu.onOpenChange}
      finalFocus={menu.finalFocus}
      contentLabel="List"
    >
      {LIST_IDS.map((id) => (
        <ActionMenuItem
          key={id}
          id={id}
          editor={editor}
          checkbox
          onPicked={menu.markPicked}
        />
      ))}
    </ToolbarMenu>
  );
}

/**
 * Registry actions end in `editor.chain().focus()`. While the sheet is
 * open the editor is `inert`, so a pick applies without pulling focus out
 * of the sheet (on a phone that would raise the keyboard over it).
 */
function setEditorInert(editor: Editor | null, inert: boolean) {
  if (!editor || editor.isDestroyed) return;
  (editor.view.dom as HTMLElement).inert = inert;
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
}

/**
 * The phone bar (< 768px, spec §4.7): one `role="toolbar"`, a constant
 * 44px tall, docked above the on-screen keyboard. Cells of at least 44×44:
 * undo, redo (360px and up; the sheet carries it below), Aa (the "Text format" sheet: style, size, colours, align, more),
 * B, I, list, indent, Insert. Toggles show their state with `aria-pressed`
 * (#269). Hidden in a read-only document (#308), which also closes the
 * sheet. Follow-ups: the context slot cell, and the selection swap
 * (`PhoneSelectionCells`, PR E).
 */
export function MobileToolbarContent({
  editor,
  ref,
  onEscape,
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
      setEditorInert(editor, open);
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

  useEffect(() => () => setEditorInert(editor, false), [editor]);

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
              onPointerEnter={loadFormatSheet}
              onFocus={loadFormatSheet}
              onTouchStart={loadFormatSheet}
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
          <Suspense fallback={<div className="st-sheet-fallback" />}>
            <FormatSheetBody
              editor={editor}
              recent={recent.recent}
              onClose={closeSheet}
            />
          </Suspense>
        </SheetContent>
      </Sheet>
      <ActionButton id="mark.bold" editor={editor} variant="phone" />
      <ActionButton id="mark.italic" editor={editor} variant="phone" />
      <ListCell editor={editor} />
      <ActionButton id="indent.indent" editor={editor} variant="phone" />
      <InsertMenu editor={editor} />
    </Toolbar>
  );
}
