"use client";

import { NodeSelection } from "@tiptap/pm/state";
import type { Editor } from "@tiptap/react";
import {
  type FocusEvent,
  type MouseEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { ActionButton } from "@/components/smart-toolbar/action-button";
import { FormatSheetBody } from "@/components/smart-toolbar/phone/format-sheet";
import {
  type MobileBarMode,
  nextMobileBarMode,
  PhoneSelectionCells,
  SELECTION_BAR_LABEL,
} from "@/components/smart-toolbar/phone-selection-cells";
import { StatusPill } from "@/components/smart-toolbar/status-pill";
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
import { announce } from "@/lib/announce";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";
import { onUiIntent } from "@/lib/editor-actions/ui-intents";
import { getEditorContextStore } from "@/lib/editor-context/store";
import { setMobileBarClearance } from "@/lib/editor-scroll-clearance";
import {
  RECENT_COLORS_CHOICE,
  useRememberedChoice,
} from "@/lib/remembered-choice";
import "@/components/smart-toolbar/phone/phone.scss";

/** The bar's constant cell height (spec §4.7), above any safe area. */
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

const noopSubscribe = () => () => {};

/**
 * A tap on an unavailable cell or sheet row says why on the status pill:
 * touch has no tooltips (design pass §6, "the pill replaces them"). The
 * reason is the control's own description (`ToolbarButton`). A capture
 * listener, since the disabled button never runs its own click.
 */
function sayWhyUnavailable(event: MouseEvent<HTMLElement>): void {
  const control =
    event.target instanceof Element
      ? event.target.closest('[aria-disabled="true"]')
      : null;
  const reason = control
    ?.getAttribute("aria-describedby")
    ?.split(" ")
    .map((id) => document.getElementById(id)?.textContent)
    .find(Boolean);
  if (reason) announce(reason);
}

/**
 * `"from:to"` while text is selected (not a caret or a node selection),
 * else null. Re-renders the bar only when that changes.
 */
function useTextSelectionKey(editor: Editor | null): string | null {
  const store = editor ? getEditorContextStore(editor) : null;
  return useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => {
      if (!editor || editor.isDestroyed) return null;
      const { selection } = editor.state;
      if (selection.empty || selection instanceof NodeSelection) return null;
      return `${selection.from}:${selection.to}`;
    },
    () => null,
  );
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
 * The phone bar (< 768px, spec §4.7): one `role="toolbar"`, with 44px of
 * cells, docked above the on-screen keyboard. Cells of at least 44×44:
 * undo, redo (from 404px; below, the sheet carries it, so the slot cell
 * never shifts the others), Aa (the
 * "Text format" sheet: style, size, colours, align, more), B, I, then
 * `menuCells` (list, indent, the context slot, Insert). Toggles show their
 * state with `aria-pressed` (#269). Hidden in a read-only document (#308),
 * which also closes the sheet. While text is selected it swaps to
 * `PhoneSelectionCells` (PR E, spec §4.7), never while focus is in the bar
 * or the sheet is open; ✕ keeps the normal cells until the selection
 * collapses. Clear of the home indicator while the keyboard is closed
 * (`data-keyboard`, `phone.scss`). The status pill (design pass §5) sits
 * 8px above it, a sibling of the cells, never in a masked element. Its own
 * lazy chunk with the sheet, loaded only below 768px (contract A9).
 */
export function MobileToolbarContent({
  editor,
  ref,
  onEscape,
  menuCells,
}: MobileToolbarContentProps) {
  const [sheetOpen, setSheetOpen] = useState(false);
  /** Opened for `formats.remove`: Your formats starts at its Remove list. */
  const [removing, setRemoving] = useState(false);
  const recent = useRememberedChoice(RECENT_COLORS_CHOICE);
  const inset = useKeyboardInset();
  const bold = useActionView("mark.bold", editor);
  const readOnly =
    bold !== null &&
    bold.enabled !== true &&
    bold.enabled.reason === READ_ONLY_REASON;
  const barRef = useRef<HTMLDivElement>(null);
  const selectionKey = useTextSelectionKey(editor);
  // ✕ dismisses the selection cells for that selection only: a new one
  // (even a direct reselect, with no caret in between) swaps them back.
  // `false`: not dismissed; otherwise the selection key ✕ was pressed on.
  const [dismissedKey, setDismissedKey] = useState<string | null | false>(
    false,
  );
  const dismissed = dismissedKey === selectionKey;
  const [focusInBar, setFocusInBar] = useState(false);
  const [mode, setMode] = useState<MobileBarMode>("all");
  const nextMode = nextMobileBarMode({
    hasTextSelection: selectionKey !== null && !sheetOpen,
    focusInBar,
    dismissedForSelection: dismissed,
    current: mode,
  });
  if (nextMode !== mode) setMode(nextMode);
  const onBarFocus = useCallback(() => setFocusInBar(true), []);
  const onBarBlur = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (!(next instanceof Node && event.currentTarget.contains(next))) {
      setFocusInBar(false);
    }
  }, []);
  const onBack = useCallback(
    () => setDismissedKey(selectionKey),
    [selectionKey],
  );

  const setRefs = useCallback(
    (node: HTMLDivElement | null) => {
      barRef.current = node;
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );

  // ProseMirror and CSS keep the caret clear of the bar and the keyboard.
  // The bar's measured height includes the bottom safe area (`phone.scss`),
  // which only CSS knows; it changes with the keyboard and the orientation.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const wrapper = bar.closest<HTMLElement>(".document-editor-wrapper");
    const update = () => {
      const height = bar.offsetHeight || MOBILE_BAR_HEIGHT;
      const clearance = readOnly ? 0 : height + inset;
      setMobileBarClearance(clearance);
      wrapper?.style.setProperty("--mobile-bar-clearance", `${clearance}px`);
      wrapper?.style.setProperty("--mobile-bar-inset", `${inset}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(bar, { box: "border-box" });
    return () => observer.disconnect();
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

  // Set by a close that hands focus on (Link opens its popover over the
  // page): the sheet must not pull focus back to Aa after its exit.
  const keepFocusOnCloseRef = useRef(false);

  const onSheetOpenChange = useCallback(
    (open: boolean) => {
      if (open) keepFocusOnCloseRef.current = false;
      else setRemoving(false);
      setPageInert(editor, open);
      setSheetOpen(open);
    },
    [editor],
  );

  // The Save dialog's "Remove a format" link at the cap (design pass §7):
  // the phone's answer is the Aa sheet at its Remove list, a frame later,
  // once the palette has closed.
  useEffect(
    () =>
      editor
        ? onUiIntent(editor, (intent) => {
            if (intent.type !== "formats.remove" || readOnly) return false;
            requestAnimationFrame(() => {
              setRemoving(true);
              onSheetOpenChange(true);
            });
            return true;
          })
        : undefined,
    [editor, readOnly, onSheetOpenChange],
  );

  /** Closes the sheet for an action that moves focus elsewhere itself. */
  const closeSheet = useCallback(() => {
    keepFocusOnCloseRef.current = true;
    onSheetOpenChange(false);
  }, [onSheetOpenChange]);

  useEffect(() => {
    if (readOnly) onSheetOpenChange(false);
  }, [readOnly, onSheetOpenChange]);

  useEffect(() => () => setPageInert(editor, false), [editor]);

  /**
   * Back to Aa; to the document when the bar just hid; nowhere when the
   * close came from an action that focused its own popover (Link).
   */
  const finalFocus = useCallback(() => {
    if (keepFocusOnCloseRef.current) {
      keepFocusOnCloseRef.current = false;
      return false;
    }
    if (!readOnly || !editor) return true;
    return documentFocusTarget(editor);
  }, [readOnly, editor]);

  if (!editor) return null;

  return (
    <Toolbar
      ref={setRefs}
      variant="docked"
      aria-label={mode === "selection" ? SELECTION_BAR_LABEL : "Formatting"}
      data-mobile-bar=""
      data-bar-mode={mode}
      data-keyboard={inset ? "" : undefined}
      hidden={readOnly}
      onEscape={onEscape}
      onFocus={onBarFocus}
      onBlur={onBarBlur}
      onClickCapture={sayWhyUnavailable}
      style={{ transform: inset ? `translateY(-${inset}px)` : undefined }}
    >
      {mode === "selection" ? (
        <PhoneSelectionCells editor={editor} onBack={onBack} />
      ) : (
        <>
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
              onClickCapture={sayWhyUnavailable}
            >
              <SheetHeader>
                <SheetTitle className="flex-1">Text format</SheetTitle>
                <SheetClose
                  render={
                    <ToolbarButton type="button" className="st-sheet-done" />
                  }
                >
                  Done
                </SheetClose>
              </SheetHeader>
              <FormatSheetBody
                editor={editor}
                recent={recent.recent}
                onClose={closeSheet}
                removing={removing}
              />
              {/* Over the sheet while it is open: the bar's pill is
                  covered and inert then, and Undo must stay reachable. */}
              <StatusPill placement="phone" />
            </SheetContent>
          </Sheet>
          <ActionButton id="mark.bold" editor={editor} variant="phone" />
          <ActionButton id="mark.italic" editor={editor} variant="phone" />
          {menuCells}
        </>
      )}
      {sheetOpen ? null : <StatusPill placement="phone" />}
    </Toolbar>
  );
}
