"use client";

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";

import type { OutlineMode } from "./use-outline-open";
import "./outline-panel.scss";

/**
 * Focuses the control that opens the outline: "Toggle outline", or the
 * View menu that holds it from T4 on (whichever is on screen).
 */
export function focusOutlineTrigger() {
  const group = document.querySelector('[data-toolbar-group="view"]');
  const target = Array.from(
    group?.querySelectorAll<HTMLElement>("button") ?? [],
  ).find((button) => button.checkVisibility?.() ?? true);
  target?.focus();
}

/** A keyboard drag of an outline item is in progress (Esc cancels it). */
const isDragging = (panel: HTMLElement) =>
  panel.querySelector('[aria-pressed="true"]') !== null ||
  panel.querySelector(".toc-sidebar-item-row--dragging") !== null;

/** Overlay only: a non-modal dialog (the page stays readable beside it). */
const OVERLAY_DIALOG = {
  role: "dialog",
  "aria-modal": false,
  "aria-label": "Outline",
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
 * item (else the first) when it opens, and Esc or the scrim close it and
 * return focus to the outline trigger. The outline stays at one tree
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
        panel?.querySelector<HTMLElement>(".toc-sidebar-item");
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

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!overlay || event.key !== "Escape" || event.defaultPrevented) return;
      if (ref.current && isDragging(ref.current)) return;
      event.preventDefault();
      event.stopPropagation();
      close();
    },
    [overlay, close],
  );

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Esc closes the overlay, which is a non-modal dialog */}
      <div
        ref={ref}
        className="outline-panel"
        data-mode={mode}
        {...(overlay ? OVERLAY_DIALOG : null)}
        onKeyDown={onKeyDown}
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
