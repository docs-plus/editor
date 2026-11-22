"use client";

import type { Editor } from "@tiptap/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { Toolbar, ToolbarSeparator } from "@/components/ui/toolbar";
import { announceLater } from "@/lib/announce-later";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import { emitUiIntent } from "@/lib/editor-actions/ui-intents";

import { ActionButton } from "../action-button";
import { PaintFormatButton } from "../formats/paint-format-button";
import { EmptyLinePlus } from "../slash/empty-line-plus";
import { StatusPill } from "../status-pill";
import { BubbleActionButton } from "./bubble-action-button";
import { bubbleReferenceRect } from "./bubble-anchor";
import { BubbleColorSplit } from "./bubble-color-split";
import {
  type BubbleController,
  createBubbleController,
} from "./bubble-controller";
import {
  BUBBLE_OFFSET,
  type BubblePlacement,
  chooseBubblePlacement,
  clearsBubbleSuppression,
  isBubbleDismissKey,
  OPEN_POPOVER_TRIGGER,
  POPOVER_CONTENT,
  shouldShowBubble,
} from "./bubble-rules";
import { BubbleStyleMenu } from "./bubble-style-menu";
import "./selection-bubble.scss";
// Installs the per-item lift behind the text styles (spec §7.2) in the
// registry, keeping it out of the editor chunk (`core/blocks.ts`).
import "@/lib/editor-actions/style-lift";

/**
 * A keyboard selection shows once Shift is up and the selection has been
 * still this long, never on auto-repeat (spec §7.2, O7 b).
 */
const KEYBOARD_SETTLE_MS = 300;

/** Exit fade (spec §11.1, O10: 120 ms in / 80 ms out). */
const EXIT_MS = 80;

/** No motion: from the OS, or the app's own `data-motion="reduce"`. */
const reducedMotion = () =>
  document.documentElement.dataset.motion === "reduce" ||
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const CARET_LABEL = ".collaboration-carets__label";
const STICKY_TOOLBAR = ':scope > [data-slot="toolbar"]';
const FOCUS_GUARD = "[data-base-ui-focus-guard]";
/** B I U S (spec §7.1 slots 2–5), refused inside inline code. */
const MARK_IDS = [
  "mark.bold",
  "mark.italic",
  "mark.underline",
  "mark.strike",
] as const;
/** Registered by the comments PR (spec §7.6); until then, no slot. */
const COMMENT_ID = "comment.add";

/**
 * The bubble's one root (v1 contract §5.2). The controller appends it to
 * the scroll container on show and removes it on hide; it is absolute, and
 * hidden until each show's first position lands (the controller hides it
 * again on hide).
 */
function createBubbleRoot(): HTMLDivElement {
  const root = document.createElement("div");
  root.className = "st-bubble";
  root.dataset.smartBubble = "";
  root.dataset.state = "closed";
  root.style.position = "absolute";
  root.style.visibility = "hidden";
  return root;
}

/**
 * 🔗 hands off in place (spec §7.5): the Hyperlink package focuses its
 * field 100 ms after it opens, so a URL typed or pasted at once would land
 * in the editor, over the selection. Focus moves to the field in the click
 * itself, and the bubble hides in the same task.
 */
function handOffToLink(controller: BubbleController | null) {
  document
    .querySelector<HTMLInputElement>(".hyperlink-create-popover input")
    ?.focus();
  controller?.hide();
}

const LINK_MARK = "hyperlink";
const COLOUR_MARKS = ["textColor", "highlight"];

/**
 * ‹› over linked or coloured text: `inlineCode` excludes every other mark,
 * so applying it removes them (spec §7.2). The pill says so, with Undo.
 */
function runInlineCode(editor: Editor, run: () => boolean) {
  const { state } = editor;
  const { from, to } = state.selection;
  const has = (name: string) => {
    const type = state.schema.marks[name];
    return type !== undefined && state.doc.rangeHasMark(from, to, type);
  };
  const adding = !editor.isActive("inlineCode");
  const link = adding && has(LINK_MARK);
  const colour = adding && COLOUR_MARKS.some(has);
  if (!run() || !(link || colour)) return;
  const what = link && colour ? "Link and colour" : link ? "Link" : "Colour";
  announceLater(`${what} removed`, {
    action: {
      label: "Undo",
      // The registry's Undo, as the colour pill's (one path).
      run: () => {
        const undo = editorActions.get("history.undo");
        if (undo) runAction(editor, undo);
      },
    },
  });
}

/** Keeps the editor's focus and selection on a click between the items. */
function keepEditorFocus(event: React.MouseEvent<HTMLElement>) {
  // React events bubble through portals: act only on the panel's own DOM.
  const target = event.target;
  if (!(target instanceof Node) || !event.currentTarget.contains(target)) {
    return;
  }
  if (!(target instanceof HTMLInputElement)) event.preventDefault();
}

interface SelectionBubbleViewProps {
  editor: Editor;
  /** `.document-editor-wrapper`: the scroll container the bubble lives in. */
  scrollTarget: HTMLElement;
}

const FINE_POINTER = "(pointer: fine)";

function subscribeFinePointer(onChange: () => void): () => void {
  const query = window.matchMedia(FINE_POINTER);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * The desktop surfaces of an editor wider than the phone bar: the
 * selection bubble (a fine pointer only; touch selects with its own
 * handles and uses the row) and the status pill (design pass §5), which
 * every desktop gets.
 */
export function SelectionBubbleView(props: SelectionBubbleViewProps) {
  const fine = useSyncExternalStore(
    subscribeFinePointer,
    () => window.matchMedia(FINE_POINTER).matches,
    () => false,
  );
  return (
    <>
      {fine ? <BubbleView {...props} /> : null}
      <StatusPill placement="desktop" />
      <EmptyLinePlus {...props} />
    </>
  );
}

/**
 * The desktop selection bubble (spec §7.1): Style ▾ │ B I U S ‹› Tx │
 * text colour split, link, Paint format │ 💬 (once registered). A `BubbleController` (spec
 * §12.1) shows, hides and positions it without a ProseMirror plugin, so
 * this lazy chunk never calls `registerPlugin`. Its items mount only while
 * it shows, so typing with no bubble runs no bubble code past the
 * controller's empty-selection exit.
 *
 * DOM contract (v1 contract §5.2, read by D1's Alt+F10): the root carries
 * `data-smart-bubble` and `data-state="open" | "closed"`, with one
 * `role="toolbar"` inside; it is a child of the scroll container only while
 * shown.
 */
function BubbleView({ editor, scrollTarget }: SelectionBubbleViewProps) {
  const [shown, setShown] = useState(false);
  // This chunk is client-only: creating the root at first render is safe.
  const [root] = useState(createBubbleRoot);
  const controllerRef = useRef<BubbleController | null>(null);
  const suppressedRef = useRef(false);
  const placementRef = useRef<BubblePlacement>("top");
  // Mirrors `placementRef` so the colour popover opens away from the text.
  const [placement, setPlacement] = useState<BubblePlacement>("top");
  const closeTimerRef = useRef<number | undefined>(undefined);
  const focusInsideRef = useRef(false);
  const restoreFocusRef = useRef(false);
  const pendingFocusRef = useRef(false);

  /**
   * Esc: fade out for 80 ms (at once with reduced motion), then hide; stays
   * hidden until a new selection.
   */
  const startClose = useCallback(() => {
    if (!root.isConnected) return;
    suppressedRef.current = true;
    root.dataset.state = "closed";
    root.dataset.closing = "";
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(
      () => controllerRef.current?.hide(),
      reducedMotion() ? 0 : EXIT_MS,
    );
  }, [root]);

  /**
   * Scrolled out (the controller hid the root in place) or wholly under the
   * sticky row (covered, WCAG 2.4.11; it scrolls with the text, so only a
   * scroll tells): not open for Alt+F10, and focus moves to the editor
   * before the browser drops it on `body`.
   */
  const syncVisibility = useCallback(() => {
    if (!root.isConnected || root.dataset.closing !== undefined) return;
    const toolbar = scrollTarget.querySelector(STICKY_TOOLBAR);
    const covered =
      root.style.visibility === "hidden" ||
      (toolbar !== null &&
        root.getBoundingClientRect().bottom <=
          toolbar.getBoundingClientRect().bottom);
    root.dataset.state = covered ? "closed" : "open";
    if (covered && focusInsideRef.current) {
      focusInsideRef.current = false;
      editor.view.focus();
    }
  }, [editor, root, scrollTarget]);

  /**
   * Hands focus to the first item once the bubble shown by Alt+F10 is laid
   * out and visible (an item in a hidden root cannot take focus).
   */
  const focusPending = useCallback(() => {
    if (!pendingFocusRef.current || root.style.visibility === "hidden") return;
    const first = root.querySelector<HTMLElement>(
      '[role="toolbar"] [data-toolbar-item]',
    );
    if (!first) return;
    pendingFocusRef.current = false;
    first.focus();
  }, [root]);

  // One controller per editor for this view's lifetime (StrictMode's second
  // effect replaces the first).
  useEffect(() => {
    if (editor.isDestroyed) return;
    const view = editor.view;

    /** Flips the bubble below when the band above its first line is taken. */
    const place = () => {
      if (!root.isConnected || editor.isDestroyed) return;
      const toolbar = scrollTarget.querySelector(STICKY_TOOLBAR);
      const next = chooseBubblePlacement({
        selection: bubbleReferenceRect(view, scrollTarget, "top"),
        bubble: { width: root.offsetWidth, height: root.offsetHeight },
        obstacles: Array.from(scrollTarget.querySelectorAll(CARET_LABEL), (n) =>
          n.getBoundingClientRect(),
        ),
        topLimit: (toolbar ?? scrollTarget).getBoundingClientRect()[
          toolbar ? "bottom" : "top"
        ],
      });
      // Only on a change: an unconditional reposition would run `place`
      // again from its own result.
      if (next === placementRef.current) return;
      placementRef.current = next;
      root.dataset.placement = next;
      setPlacement(next);
      controller.setPlacement(next);
      controller.updatePosition();
    };

    const controller = createBubbleController(editor, scrollTarget, {
      root,
      keyboardSettleMs: KEYBOARD_SETTLE_MS,
      shouldShow: () => shouldShowBubble(view, root, suppressedRef.current),
      getReferenceRect: (side) =>
        bubbleReferenceRect(
          view,
          scrollTarget,
          side,
          BUBBLE_OFFSET + root.offsetHeight,
        ),
      onShow: () => {
        window.clearTimeout(closeTimerRef.current);
        root.dataset.state = "open";
        root.dataset.placement = placementRef.current;
        setPlacement(placementRef.current);
        delete root.dataset.closing;
        setShown(true);
      },
      onHide: () => {
        window.clearTimeout(closeTimerRef.current);
        root.dataset.state = "closed";
        delete root.dataset.closing;
        pendingFocusRef.current = false;
        restoreFocusRef.current = focusInsideRef.current;
        focusInsideRef.current = false;
        setShown(false);
      },
      onPosition: () => {
        syncVisibility();
        place();
        focusPending();
      },
    });
    controller.setPlacement(placementRef.current);
    controllerRef.current = controller;
    // A selection made before this chunk landed shows now.
    controller.update();
    return () => {
      controller.destroy();
      if (controllerRef.current === controller) controllerRef.current = null;
    };
  }, [editor, scrollTarget, root, syncVisibility, focusPending]);

  /**
   * Alt+F10 with a selection the bubble has not shown yet (its delay, or a
   * keyboard selection still settling): show it at once and put focus on
   * its first item (Style ▾, spec §14) once it is laid out, instead of the
   * row. A capture listener on the editor, so it runs before ProseMirror's
   * keymap (`editor-action-shortcuts`), which would send focus to the row:
   * a just-shown bubble has no items to focus yet.
   */
  useEffect(() => {
    if (editor.isDestroyed) return;
    const dom = editor.view.dom;
    const onAltF10 = (event: KeyboardEvent) => {
      if (event.key !== "F10" || !event.altKey) return;
      const controller = controllerRef.current;
      if (!controller || controller.visible) return;
      controller.update();
      if (!controller.visible) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      pendingFocusRef.current = true;
    };
    dom.addEventListener("keydown", onAltF10, { capture: true });
    return () =>
      dom.removeEventListener("keydown", onAltF10, { capture: true });
  }, [editor]);

  // One keydown and one mousedown listener on the editor, for the editor's
  // lifetime. They do nothing unless the bubble is in the DOM, so typing
  // with no bubble does nothing extra.
  useEffect(() => {
    if (editor.isDestroyed) return;
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if (clearsBubbleSuppression(event)) {
        suppressedRef.current = false;
        return;
      }
      if (!isBubbleDismissKey(event)) return;
      if (!root.isConnected) {
        // A bubble still waiting (its delay, a keyboard settle): Esc says
        // no to it too; the settle's or delay's re-check finds it
        // suppressed until a new selection.
        if (event.key === "Escape") suppressedRef.current = true;
        return;
      }
      if (event.key === "Escape") {
        startClose();
        return;
      }
      suppressedRef.current = true;
      controllerRef.current?.hide();
    };
    const onMouseDown = () => {
      suppressedRef.current = false;
    };
    dom.addEventListener("keydown", onKeyDown);
    dom.addEventListener("mousedown", onMouseDown);
    return () => {
      dom.removeEventListener("keydown", onKeyDown);
      dom.removeEventListener("mousedown", onMouseDown);
      window.clearTimeout(closeTimerRef.current);
    };
  }, [editor, root, startClose]);

  // While shown: hide when focus moves anywhere but the editor, the bubble
  // or its popups (colour dialog), from the editor or from the bubble (the
  // controller's blur check never sees a blur from the bubble itself).
  // Track whether focus is in the bubble or a popup. Read-only hides in the
  // controller (`update` event).
  useEffect(() => {
    if (!shown) return;
    const hide = () => controllerRef.current?.hide();
    // Focus to the window or `body` fires no `focusin`. This also covers a
    // `preventHide` left set by a click in the bubble.
    const onEditorBlur = ({ event }: { event: FocusEvent }) => {
      if (event.relatedTarget === null) hide();
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const inPopover =
        target.closest(POPOVER_CONTENT) !== null ||
        // Base UI's guards next to the portal hand focus straight on.
        target.matches(FOCUS_GUARD);
      focusInsideRef.current =
        root.contains(target) ||
        (root.querySelector(OPEN_POPOVER_TRIGGER) !== null && inPopover);
      // After the ref: a hide with focus outside restores nothing.
      if (
        !focusInsideRef.current &&
        !inPopover &&
        !editor.view.dom.contains(target)
      ) {
        hide();
      }
    };
    // Tab past the last stop (or a click on nothing) drops focus on `body`,
    // which fires no `focusin`. Not a window switch: that keeps the bubble.
    // `focusInsideRef` stays set, so `onHide` hands focus back to the editor
    // with its selection, and the bubble stays away until a new selection
    // (as after Esc) instead of reopening on that focus.
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget !== null || !document.hasFocus()) return;
      // The controller's own hide removes a focused item: not a Tab out.
      if (!controllerRef.current?.visible) return;
      suppressedRef.current = true;
      hide();
    };
    // The controller repositions on scroll after a debounce; the sticky
    // row covers the bubble frame by frame.
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        syncVisibility();
      });
    };
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    editor.on("blur", onEditorBlur);
    document.addEventListener("focusin", onFocusIn, true);
    root.addEventListener("focusout", onFocusOut);
    return () => {
      root.removeEventListener("focusout", onFocusOut);
      scrollTarget.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      editor.off("blur", onEditorBlur);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [shown, editor, root, scrollTarget, syncVisibility]);

  useLayoutEffect(() => {
    if (shown) {
      // Items just mounted: position (and place) with the real size.
      controllerRef.current?.updatePosition();
      return;
    }
    if (!restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    // Hidden with focus inside (read-only, a remote edit): never leave it
    // on `body`. The popover returns focus to its trigger first, if it can.
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      if (editor.isDestroyed) return;
      if (editor.isEditable) editor.view.focus();
      else emitUiIntent(editor, { type: "toolbar.focus" });
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, editor]);

  /** Esc on an item: back to the document with its selection, then fade. */
  const onEscape = useCallback(() => {
    editor.view.focus();
    startClose();
  }, [editor, startClose]);

  return createPortal(
    shown ? (
      <Toolbar
        variant="floating"
        aria-label="Selection formatting"
        className="st-bubble-panel"
        onEscape={onEscape}
        onMouseDown={keepEditorFocus}
      >
        <BubbleStyleMenu editor={editor} placement={placement} />
        <ToolbarSeparator />
        {MARK_IDS.map((id) => (
          <BubbleActionButton key={id} id={id} editor={editor} />
        ))}
        <BubbleActionButton
          id="mark.inlineCode"
          editor={editor}
          onRun={(run) => runInlineCode(editor, run)}
        />
        <ActionButton id="format.clear" editor={editor} variant="bubble" />
        <ToolbarSeparator />
        <BubbleColorSplit editor={editor} placement={placement} />
        <BubbleActionButton
          id="mark.link"
          editor={editor}
          onRun={(run) => {
            if (run()) handOffToLink(controllerRef.current);
          }}
        />
        <PaintFormatButton editor={editor} />
        {/* Comment (spec §7.6): last, and absent until the comments PR
            registers `comment.add`, so its group shifts nothing. */}
        {editorActions.has(COMMENT_ID) ? (
          <>
            <ToolbarSeparator />
            <ActionButton id={COMMENT_ID} editor={editor} variant="bubble" />
          </>
        ) : null}
      </Toolbar>
    ) : null,
    root,
  );
}
