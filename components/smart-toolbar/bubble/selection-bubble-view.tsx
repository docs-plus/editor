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
import { emitUiIntent } from "@/lib/editor-actions/ui-intents";

import { ActionButton } from "../action-button";
import { ColorSplit } from "../color-controls";
import { PaintFormatButton } from "../formats/paint-format-button";
import { StatusPill } from "../status-pill";
import { bubbleReferenceRect } from "./bubble-anchor";
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
import "./selection-bubble.scss";

/** Exit fade (spec §4.3: 140 ms in / 90 ms out). */
const EXIT_MS = 90;
const CARET_LABEL = ".collaboration-carets__label";
const STICKY_TOOLBAR = ':scope > [data-slot="toolbar"]';
const FOCUS_GUARD = "[data-base-ui-focus-guard]";

/**
 * The bubble's one root (v1 contract §5.2). The controller appends it to
 * the scroll container on show and removes it on hide; it is absolute and
 * hidden until the first position lands.
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
    </>
  );
}

/**
 * The desktop selection bubble (spec §4.3, design pass §1): B · I · U │
 * text colour split │ link │ Paint format. A `BubbleController` (spec
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

  /** Esc: fade out for 90 ms, then hide; stays hidden until a new selection. */
  const startClose = useCallback(() => {
    if (!root.isConnected) return;
    suppressedRef.current = true;
    root.dataset.state = "closed";
    root.dataset.closing = "";
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(
      () => controllerRef.current?.hide(),
      EXIT_MS,
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
        restoreFocusRef.current = focusInsideRef.current;
        focusInsideRef.current = false;
        setShown(false);
      },
      onPosition: () => {
        syncVisibility();
        place();
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
  }, [editor, scrollTarget, root, syncVisibility]);

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
      if (!root.isConnected || !isBubbleDismissKey(event)) return;
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
        <ActionButton id="mark.bold" editor={editor} variant="bubble" />
        <ActionButton id="mark.italic" editor={editor} variant="bubble" />
        <ActionButton id="mark.underline" editor={editor} variant="bubble" />
        <ToolbarSeparator />
        <ColorSplit kind="text" editor={editor} popoverSide={placement} />
        <ToolbarSeparator />
        <ActionButton id="mark.link" editor={editor} variant="bubble" />
        <ToolbarSeparator />
        <PaintFormatButton editor={editor} />
      </Toolbar>
    ) : null,
    root,
  );
}
