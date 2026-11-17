import {
  autoUpdate,
  computePosition,
  hide as hideMiddleware,
  offset,
  shift,
  type VirtualElement,
} from "@floating-ui/dom";
import type { Editor, EditorEvents } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import { BUBBLE_OFFSET, type BubblePlacement } from "./bubble-rules";

/**
 * Selection bubble controller (spec §12.1): shows, hides and positions one
 * root element for an editor without a ProseMirror plugin, so the lazy
 * bubble chunk never calls `registerPlugin` (which re-creates every plugin
 * view). The behaviours copy Tiptap's `bubble-menu-plugin.ts`
 * (`@tiptap/extension-bubble-menu` 3.33); line numbers below cite it.
 */

/** Delay before a non-empty selection shows the bubble (`updateDelay`, :378). */
export const BUBBLE_SHOW_DELAY_MS = 250;
/** Debounce for repositioning on resize and scroll (`resizeDelay`, :379). */
export const BUBBLE_RESIZE_DELAY_MS = 60;

/** What the controller drives: the view's root, rules and callbacks. */
export interface BubbleHost {
  /** Reused; appended to the scroll target on show, removed on hide. */
  readonly root: HTMLElement;
  /** The view's `shouldShowBubble` plus its suppression. */
  shouldShow(): boolean;
  /** The anchor for `placement`, in client coordinates. */
  getReferenceRect(placement: BubblePlacement): DOMRect;
  onShow(): void;
  onHide(): void;
  /** After each applied position (or reference-hidden) result. */
  onPosition(): void;
}

/** One editor's bubble: its visibility, position and teardown. */
export interface BubbleController {
  readonly visible: boolean;
  /** Re-evaluates now, without the show delay. */
  update(): void;
  updatePosition(): void;
  hide(): void;
  /** Stores the side; the next `updatePosition` uses it. */
  setPlacement(placement: BubblePlacement): void;
  /** Removes every listener and timer and hides. Idempotent. */
  destroy(): void;
}

type Timer = ReturnType<typeof setTimeout> | undefined;

/** One controller per editor (StrictMode effects run twice). */
const controllers = new WeakMap<Editor, BubbleController>();

/**
 * Whether a dispatch set the selection or changed the doc. The
 * `transaction` event carries no previous state, and these flags are O(1)
 * where `doc.eq` (the plugin's check, :534-535) is O(top-level blocks).
 * A selection set to an equal one counts: it only restarts the delay.
 */
function changesSelectionOrDoc(
  transaction: Transaction,
  appended: readonly Transaction[],
): boolean {
  const changes = (tr: Transaction) => tr.docChanged || tr.selectionSet;
  return changes(transaction) || appended.some(changes);
}

/**
 * Creates the bubble controller for `editor`, replacing any earlier one.
 * The root is appended to `scrollTarget` (`.document-editor-wrapper`) on
 * show and removed synchronously on hide (v1 contract §5.2).
 */
export function createBubbleController(
  editor: Editor,
  scrollTarget: HTMLElement,
  host: BubbleHost,
): BubbleController {
  controllers.get(editor)?.destroy();

  // Captured once: after `editor.destroy()`, `editor.view` is a proxy.
  const view = editor.view;
  const dom = view.dom;
  const { root } = host;

  let visible = false;
  let destroyed = false;
  let placement: BubblePlacement = "top";
  let dragging = false;
  let preventHide = false;
  let showTimer: Timer;
  let deferTimer: Timer;
  let resizeTimer: Timer;
  let stopAutoUpdate: (() => void) | undefined;
  /** Bumped per position request and on hide: stale results are dropped. */
  let positionRun = 0;

  const reference: VirtualElement = {
    getBoundingClientRect: () => host.getReferenceRect(placement),
    contextElement: dom,
  };

  function updatePosition() {
    if (!visible || destroyed) return;
    const run = ++positionRun;
    computePosition(reference, root, {
      strategy: "absolute",
      placement,
      middleware: [
        offset(BUBBLE_OFFSET),
        shift({ padding: 8 }),
        hideMiddleware(),
      ],
    }).then(
      ({ x, y, strategy, middlewareData }) => {
        if (run !== positionRun) return;
        // Scrolled out or clipped: hidden in place, not removed (:508-511).
        const clipped = middlewareData.hide;
        if (clipped?.referenceHidden || clipped?.escaped) {
          root.style.visibility = "hidden";
        } else {
          root.style.visibility = "visible";
          root.style.width = "max-content";
          root.style.position = strategy;
          root.style.left = `${x}px`;
          root.style.top = `${y}px`;
        }
        host.onPosition();
      },
      () => {
        // No layout (happy-dom) or a reference that threw: keep the last
        // position.
      },
    );
  }

  /**
   * :605-622, plus `autoUpdate` while shown. `ancestorScroll: false`: the
   * root scrolls with the text; the debounced scroll listener re-runs the
   * `hide` middleware.
   */
  function show() {
    if (visible) return;
    visible = true;
    scrollTarget.appendChild(root);
    host.onShow();
    if (!visible) return;
    try {
      stopAutoUpdate = autoUpdate(reference, root, updatePosition, {
        ancestorScroll: false,
        elementResize: true,
      });
    } catch {
      updatePosition();
    }
  }

  /** :624-639. Cancels a pending show; the root leaves before `onHide`. */
  function hide() {
    clearTimeout(showTimer);
    showTimer = undefined;
    if (!visible) return;
    visible = false;
    positionRun += 1;
    stopAutoUpdate?.();
    stopAutoUpdate = undefined;
    root.remove();
    // A later show stays hidden until its first position lands.
    root.style.visibility = "hidden";
    host.onHide();
  }

  /** Re-evaluates now (`updateHandler`, :579-603). Never shows mid-drag. */
  function update() {
    clearTimeout(showTimer);
    showTimer = undefined;
    if (destroyed || editor.isDestroyed || view.composing) return;
    if (editor.state.selection.empty || !host.shouldShow()) {
      hide();
      return;
    }
    if (visible) updatePosition();
    else if (!dragging) show();
  }

  /**
   * Hides at once, or (re)starts the show delay (:529-555). A drag waits
   * for `pointerup`, which evaluates again.
   */
  function evaluate() {
    if (destroyed || editor.isDestroyed || view.composing) return;
    if (editor.state.selection.empty || !host.shouldShow()) {
      hide();
      return;
    }
    if (dragging) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(() => {
      showTimer = undefined;
      update();
    }, BUBBLE_SHOW_DELAY_MS);
  }

  /** Evaluates once the selection has settled (focus :459-462, IME :431-442). */
  function evaluateLater() {
    clearTimeout(deferTimer);
    deferTimer = setTimeout(() => {
      deferTimer = undefined;
      evaluate();
    });
  }

  // Every keystroke runs this: typing with no bubble exits on the first line.
  const onTransaction = ({
    transaction,
    appendedTransactions,
  }: EditorEvents["transaction"]) => {
    if (!visible && editor.state.selection.empty) return;
    if (view.composing) return;
    if (!changesSelectionOrDoc(transaction, appendedTransactions)) return;
    evaluate();
  };

  /**
   * Focus (:459-462) re-evaluates only while hidden. While shown, focus
   * coming back from an item (Esc) must not hide at once: the view's
   * suppression would cut its exit fade, which the plugin's debounced
   * focus handler let play.
   */
  const onFocus = () => {
    if (!visible) evaluateLater();
  };

  /** :464-484, but only focus moving into the root itself keeps it. */
  const onBlur = ({ event }: EditorEvents["blur"]) => {
    if (preventHide) {
      preventHide = false;
      return;
    }
    const related = event?.relatedTarget as Node | null | undefined;
    if (related && (related === dom || root.contains(related))) return;
    hide();
  };

  // `setEditable` emits `update` and no transaction.
  const onUpdate = () => {
    if (editor.isEditable) return;
    hide();
  };

  const onRootMouseDown = () => {
    preventHide = true;
  };

  // A context menu or a drag may swallow the `pointerup`: never stay stuck.
  const onHideEvent = () => {
    dragging = false;
    hide();
  };

  const onPointerDown = () => {
    dragging = true;
  };

  // On the window: a drag-select often ends outside the editor.
  const onPointerUp = () => {
    if (!dragging) return;
    dragging = false;
    evaluate();
  };

  /** Resize and scroll (:411-412, :449-457): reposition, debounced. */
  const onReposition = () => {
    if (!visible) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      resizeTimer = undefined;
      updatePosition();
    }, BUBBLE_RESIZE_DELAY_MS);
  };

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    editor.off("transaction", onTransaction);
    editor.off("focus", onFocus);
    editor.off("blur", onBlur);
    editor.off("update", onUpdate);
    editor.off("destroy", destroy);
    root.removeEventListener("mousedown", onRootMouseDown, { capture: true });
    dom.removeEventListener("dragstart", onHideEvent);
    dom.removeEventListener("contextmenu", onHideEvent);
    dom.removeEventListener("compositionend", evaluateLater);
    dom.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("resize", onReposition);
    scrollTarget.removeEventListener("scroll", onReposition);
    clearTimeout(deferTimer);
    clearTimeout(resizeTimer);
    deferTimer = undefined;
    resizeTimer = undefined;
    hide();
    if (controllers.get(editor) === controller) controllers.delete(editor);
  }

  editor.on("transaction", onTransaction);
  editor.on("focus", onFocus);
  editor.on("blur", onBlur);
  editor.on("update", onUpdate);
  editor.on("destroy", destroy);
  root.addEventListener("mousedown", onRootMouseDown, { capture: true });
  dom.addEventListener("dragstart", onHideEvent);
  dom.addEventListener("contextmenu", onHideEvent);
  dom.addEventListener("compositionend", evaluateLater);
  dom.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("resize", onReposition);
  scrollTarget.addEventListener("scroll", onReposition, { passive: true });

  const controller: BubbleController = {
    get visible() {
      return visible;
    },
    update,
    updatePosition,
    hide,
    setPlacement(next) {
      placement = next;
    },
    destroy,
  };
  controllers.set(editor, controller);
  return controller;
}
