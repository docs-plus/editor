"use client";

import {
  type FocusEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

import type { OutlineMode } from "./use-outline-open";
import "./outline-panel.scss";

/** The outline trigger's group: focus moving there toggles, not closes. */
const VIEW_GROUP = '[data-toolbar-group="view"]';

/**
 * Focuses the control that opens the outline: "Toggle outline", or the
 * View menu that holds it from T4 on (whichever is on screen).
 */
export function focusOutlineTrigger() {
  const group = document.querySelector(VIEW_GROUP);
  const target = Array.from(
    group?.querySelectorAll<HTMLElement>("button") ?? [],
  ).find((button) => button.checkVisibility?.() ?? true);
  target?.focus();
}

/** A keyboard drag of an outline item is in progress (Esc cancels it). */
const isDragging = (panel: HTMLElement) =>
  panel.querySelector('[aria-pressed="true"]') !== null ||
  panel.querySelector(".toc-sidebar-item-row--dragging") !== null;

/**
 * Overlay only: a non-modal dialog (the page stays readable beside it)
 * that closes when focus leaves it. Focusable itself, so an outline with
 * no headings still takes focus.
 */
const OVERLAY_DIALOG = {
  role: "dialog",
  "aria-modal": false,
  "aria-label": "Outline",
  tabIndex: -1,
} as const;

interface OutlinePanelProps {
  mode: OutlineMode;
  onClose: () => void;
  children: ReactNode;
}

/**
 * The outline's frame (spec §4.6, D2 Decision 5). Docked, it is today's
 * sidebar. As an overlay (768–949px) it slides over the page below the
 * sticky toolbar, with a scrim named "Close outline"; it focuses the active
 * item (else the first, else itself) when it opens. Esc anywhere or the
 * scrim close it and return focus to the outline trigger; focus moving
 * to anything else closes it too. The outline stays at one tree
 * position in both modes, so crossing 950px keeps a focused item mounted.
 */
export function OutlinePanel({ mode, onClose, children }: OutlinePanelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const overlay = mode === "overlay";

  // Opening as an overlay moves focus into it.
  useEffect(() => {
    if (!overlay) return;
    const frame = requestAnimationFrame(() => {
      const panel = ref.current;
      const item =
        panel?.querySelector<HTMLElement>(".toc-sidebar-item--active") ??
        panel?.querySelector<HTMLElement>(".toc-sidebar-item") ??
        panel;
      item?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [overlay]);

  // Closing (or a resize that hides it) with focus inside must not drop
  // focus on <body>: hand it to the outline trigger.
  useLayoutEffect(() => {
    const panel = ref.current;
    return () => {
      if (!panel?.contains(document.activeElement)) return;
      requestAnimationFrame(() => {
        if (document.activeElement && document.activeElement !== document.body)
          return;
        focusOutlineTrigger();
      });
    };
  }, []);

  const close = useCallback(() => {
    onClose();
    focusOutlineTrigger();
  }, [onClose]);

  // Esc anywhere closes the overlay, except in an open menu (focus moving
  // anywhere else closes it first) or while a keyboard drag of an item is
  // in progress.
  useEffect(() => {
    if (!overlay) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const panel = ref.current;
      const target = event.target as Element;
      if (
        event.key !== "Escape" ||
        !panel ||
        isDragging(panel) ||
        target.closest('[role="menu"]')
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [overlay, close]);

  // Focus moving out of the overlay (Tab, a click) closes it. Not to the
  // scrim (its click closes and returns focus) or the trigger (its click
  // toggles), nor to nothing (a window switch, a removed item).
  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget as Element | null;
    if (
      overlay &&
      next &&
      !event.currentTarget.contains(next) &&
      !next.closest(`.outline-scrim, ${VIEW_GROUP}`)
    ) {
      onClose();
    }
  };

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: focus leaving closes the overlay, a dialog (role set with the overlay props) */}
      <div
        ref={ref}
        className="outline-panel"
        data-mode={mode}
        {...(overlay ? OVERLAY_DIALOG : null)}
        onBlur={onBlur}
      >
        {children}
      </div>
      {overlay && (
        <button
          type="button"
          className="outline-scrim"
          aria-label="Close outline"
          tabIndex={-1}
          onClick={close}
        />
      )}
    </>
  );
}
