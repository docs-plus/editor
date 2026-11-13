"use client";

import { PluginKey } from "@tiptap/pm/state";
import type { EditorView } from "@tiptap/pm/view";
import { type Editor, posToDOMRect } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Toolbar, ToolbarSeparator } from "@/components/ui/toolbar";
import { emitUiIntent } from "@/lib/editor-actions/ui-intents";

import { ActionButton } from "../action-button";
import { ColorSplit } from "../color-controls";
import { RepeatSplitButton } from "../repeat-split-button";
import {
  BUBBLE_OFFSET,
  type BubblePlacement,
  chooseBubblePlacement,
  clearsBubbleSuppression,
  isBubbleDismissKey,
  OPEN_POPOVER_TRIGGER,
  shouldShowBubble,
} from "./bubble-rules";
import "./selection-bubble.scss";

/** One key for every editor: plugin state is per editor state. */
const BUBBLE_KEY = new PluginKey("selectionBubble");
/** Exit fade (spec §4.3: 140 ms in / 90 ms out). */
const EXIT_MS = 90;
const CARET_LABEL = ".collaboration-carets__label";
const STICKY_TOOLBAR = ':scope > [data-slot="toolbar"]';
const POPOVER_CONTENT = '[data-slot="popover-content"]';
const FOCUS_GUARD = "[data-base-ui-focus-guard]";

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

/**
 * The desktop selection bubble (spec §4.3): B · I · U │ text colour split │
 * link (│ Repeat, E). A `BubbleMenu` registered once per editor with stable
 * props; its items mount only while it shows, so typing with no bubble
 * runs no bubble code past `shouldShowBubble`'s empty-selection exit.
 *
 * DOM contract (v1 contract §5.2, read by D1's Alt+F10): the root carries
 * `data-smart-bubble` and `data-state="open" | "closed"`, with one
 * `role="toolbar"` inside.
 */
export function SelectionBubbleView({
  editor,
  scrollTarget,
}: SelectionBubbleViewProps) {
  const [shown, setShown] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const suppressedRef = useRef(false);
  const placementRef = useRef<BubblePlacement>("top");
  // Mirrors `placementRef` so the colour popover opens away from the text.
  const [placement, setPlacement] = useState<BubblePlacement>("top");
  const closeTimerRef = useRef<number | undefined>(undefined);
  const focusInsideRef = useRef(false);
  const restoreFocusRef = useRef(false);

  const dispatchMeta = useCallback(
    (meta: unknown) => {
      if (editor.isDestroyed) return;
      editor.view.dispatch(editor.state.tr.setMeta(BUBBLE_KEY, meta));
    },
    [editor],
  );

  /** Esc: fade out for 90 ms, then hide; stays hidden until a new selection. */
  const startClose = useCallback(() => {
    const root = rootRef.current;
    if (!root?.isConnected) return;
    suppressedRef.current = true;
    root.dataset.state = "closed";
    root.dataset.closing = "";
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(
      () => dispatchMeta("hide"),
      EXIT_MS,
    );
  }, [dispatchMeta]);

  const shouldShow = useCallback(
    ({ view, element }: { view: EditorView; element: HTMLElement }) =>
      shouldShowBubble(view, element, suppressedRef.current),
    [],
  );

  const options = useMemo(() => {
    const base = {
      scrollTarget,
      strategy: "absolute" as const,
      placement: "top" as const,
      offset: BUBBLE_OFFSET,
      // The side is decided here (toolbar, remote caret labels), not by flip.
      flip: false,
      shift: { padding: 8 },
      hide: true,
    };

    /** Flips the bubble below when the band above is taken. */
    const place = () => {
      const root = rootRef.current;
      if (!root?.isConnected || editor.isDestroyed) return;
      const { from, to } = editor.state.selection;
      const toolbar = scrollTarget.querySelector(STICKY_TOOLBAR);
      const next = chooseBubblePlacement({
        selection: posToDOMRect(editor.view, from, to),
        bubble: { width: root.offsetWidth, height: root.offsetHeight },
        obstacles: Array.from(scrollTarget.querySelectorAll(CARET_LABEL), (n) =>
          n.getBoundingClientRect(),
        ),
        topLimit: (toolbar ?? scrollTarget).getBoundingClientRect()[
          toolbar ? "bottom" : "top"
        ],
      });
      if (next === placementRef.current) return;
      placementRef.current = next;
      root.dataset.placement = next;
      setPlacement(next);
      dispatchMeta({
        type: "updateOptions",
        options: { options: { ...base, placement: next } },
      });
      dispatchMeta("updatePosition");
    };

    return {
      ...base,
      onShow: () => {
        const root = rootRef.current;
        if (!root) return;
        window.clearTimeout(closeTimerRef.current);
        // The plugin makes its root a Tab stop; the toolbar inside has one.
        // Not `-1` either: a click on the panel would focus a nameless div.
        root.removeAttribute("tabindex");
        root.dataset.state = "open";
        root.dataset.placement = placementRef.current;
        setPlacement(placementRef.current);
        delete root.dataset.closing;
        setShown(true);
      },
      onHide: () => {
        const root = rootRef.current;
        window.clearTimeout(closeTimerRef.current);
        if (root) {
          root.dataset.state = "closed";
          delete root.dataset.closing;
        }
        restoreFocusRef.current = focusInsideRef.current;
        focusInsideRef.current = false;
        setShown(false);
      },
      onUpdate: place,
    };
  }, [editor, scrollTarget, dispatchMeta]);

  // `BubbleMenu` keeps one root for its lifetime. When it registers again
  // (dev StrictMode's double effect, or a new editor), the previous
  // cleanup removes that root one frame later if it has a parent. With a
  // selection already there (this chunk landed after it) the new plugin
  // shows the root at once, so the removal detaches a shown bubble without
  // `onHide`, and the plugin never shows it again. This frame runs after
  // that one: put the root back where the plugin shows it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root || root.isConnected || root.dataset.state !== "open") return;
      scrollTarget.appendChild(root);
      dispatchMeta("updatePosition");
    });
    return () => cancelAnimationFrame(frame);
  }, [scrollTarget, dispatchMeta]);

  // One keydown and one mousedown listener on the editor, for the editor's
  // lifetime. They do nothing unless the bubble is in the DOM, so typing
  // with no bubble dispatches nothing extra.
  useEffect(() => {
    const dom = editor.view.dom;
    const onKeyDown = (event: KeyboardEvent) => {
      if (clearsBubbleSuppression(event)) {
        suppressedRef.current = false;
        return;
      }
      if (!rootRef.current?.isConnected || !isBubbleDismissKey(event)) return;
      if (event.key === "Escape") {
        startClose();
        return;
      }
      suppressedRef.current = true;
      dispatchMeta("hide");
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
  }, [editor, dispatchMeta, startClose]);

  // While shown: hide on read-only (`setEditable` changes neither the
  // selection nor the document, so the plugin never re-checks) and when
  // focus moves anywhere but the editor, the bubble or its colour popover,
  // from the editor or from the bubble (the stock blur check keeps it for
  // anything inside its parent, the whole editor shell, and never sees a
  // blur from the bubble itself). Track whether focus is in the bubble or
  // its popover.
  useEffect(() => {
    if (!shown) return;
    const root = rootRef.current;
    const onEditorUpdate = () => {
      if (!editor.isEditable) queueMicrotask(() => dispatchMeta("hide"));
    };
    // Focus to the window or `body` fires no `focusin`.
    const onEditorBlur = ({ event }: { event: FocusEvent }) => {
      if (event.relatedTarget === null) dispatchMeta("hide");
    };
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target;
      if (!root || !(target instanceof Element)) return;
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
        dispatchMeta("hide");
      }
    };
    // Tab past the last stop (or a click on nothing) drops focus on `body`,
    // which fires no `focusin`. Not a window switch: that keeps the bubble.
    // `focusInsideRef` stays set, so `onHide` hands focus back to the editor
    // with its selection, and the bubble stays away until a new selection
    // (as after Esc) instead of reopening on that focus.
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget !== null || !document.hasFocus()) return;
      // The plugin's own `hide()` (it sets opacity 0, then removes the
      // root) blurs a focused item mid-dispatch: a nested hide here would
      // make its `remove()` throw. `onHide` restores focus as above.
      if (root?.style.opacity === "0") return;
      suppressedRef.current = true;
      dispatchMeta("hide");
    };
    // `hide: true` hides the root (inline `visibility`) when the selection
    // scrolls out, without `onHide`; wholly under the sticky row it is
    // covered (WCAG 2.4.11; it scrolls with the text, so only a scroll
    // tells). Either way it is not open for Alt+F10, and focus moves to the
    // editor before the browser drops it on `body`.
    const toolbar = scrollTarget.querySelector(STICKY_TOOLBAR);
    const syncVisibility = () => {
      if (!root?.isConnected || root.dataset.closing !== undefined) return;
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
    };
    const observer = new MutationObserver(syncVisibility);
    if (root) observer.observe(root, { attributeFilter: ["style"] });
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        syncVisibility();
      });
    };
    scrollTarget.addEventListener("scroll", onScroll, { passive: true });
    editor.on("update", onEditorUpdate);
    editor.on("blur", onEditorBlur);
    document.addEventListener("focusin", onFocusIn, true);
    root?.addEventListener("focusout", onFocusOut);
    return () => {
      root?.removeEventListener("focusout", onFocusOut);
      observer.disconnect();
      scrollTarget.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(frame);
      editor.off("update", onEditorUpdate);
      editor.off("blur", onEditorBlur);
      document.removeEventListener("focusin", onFocusIn, true);
    };
  }, [shown, editor, scrollTarget, dispatchMeta]);

  useLayoutEffect(() => {
    if (shown) {
      // Items just mounted: position (and place) with the real size.
      dispatchMeta("updatePosition");
      return;
    }
    if (!restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    // Hidden with focus inside (read-only, a remote edit): never leave it
    // on `body`. The popover returns focus to its trigger first, if it can.
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      if (editor.isEditable) editor.view.focus();
      else emitUiIntent(editor, { type: "toolbar.focus" });
    });
    return () => cancelAnimationFrame(frame);
  }, [shown, editor, dispatchMeta]);

  /** Esc on an item: back to the document with its selection, then fade. */
  const onEscape = useCallback(() => {
    editor.view.focus();
    startClose();
  }, [editor, startClose]);

  return (
    <BubbleMenu
      ref={rootRef}
      editor={editor}
      pluginKey={BUBBLE_KEY}
      shouldShow={shouldShow}
      appendTo={scrollTarget}
      options={options}
      className="st-bubble"
      data-smart-bubble=""
    >
      {shown ? (
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
          <RepeatSplitButton editor={editor} />
        </Toolbar>
      ) : null}
    </BubbleMenu>
  );
}
