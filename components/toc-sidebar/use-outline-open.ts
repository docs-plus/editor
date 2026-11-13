"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useIsBreakpoint } from "@/hooks/use-is-breakpoint";
import {
  OUTLINE_OPEN_CHOICE,
  readChoice,
  rememberChoice,
} from "@/lib/remembered-choice";

export type SetOutlineOpen = (
  next: boolean | ((open: boolean) => boolean),
) => void;

/** Below this viewport width the outline overlays the page (spec §4.6). */
export const OUTLINE_OVERLAY_BELOW = 950;

/** "docked" sits beside the page; "overlay" slides over it. */
export type OutlineMode = "docked" | "overlay";

export interface OutlineView {
  mode: OutlineMode;
  /** Closes the overlay; a no-op when docked (it never writes). */
  close: () => void;
}

/**
 * M6: the outline's open state, remembered under `tinydocy-ui` (Forget
 * keeps it). Starts open on the server and the first client render, then
 * reads storage in an effect, so hydration always matches. The setter is
 * the shell's one memory writer for this slot (contract §6, exception 1)
 * and keeps the pinned `setOutlineOpen` signature (contract §5.2); the
 * third element adds the mode (contract §10 A6).
 *
 * Below 950px the outline is an overlay (D2 Decision 5): its open state is
 * transient, starts closed, resets on every mode change and is never
 * written, so a remembered "open" never covers the page on load. Crossing
 * back to docked shows the remembered state again.
 */
export function useOutlineOpen(): [boolean, SetOutlineOpen, OutlineView] {
  const overlay = useIsBreakpoint("max", OUTLINE_OVERLAY_BELOW);
  const [docked, setDocked] = useState(OUTLINE_OPEN_CHOICE.fallback);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const dockedRef = useRef(docked);
  const overlayRef = useRef(overlay);
  const overlayOpenRef = useRef(false);

  useEffect(() => {
    const stored = readChoice(OUTLINE_OPEN_CHOICE).last;
    dockedRef.current = stored;
    setDocked(stored);
  }, []);

  // A mode change always starts the overlay closed.
  useEffect(() => {
    overlayRef.current = overlay;
    overlayOpenRef.current = false;
    setOverlayOpen(false);
  }, [overlay]);

  const setOutlineOpen = useCallback<SetOutlineOpen>((next) => {
    if (overlayRef.current) {
      const value =
        typeof next === "function" ? next(overlayOpenRef.current) : next;
      overlayOpenRef.current = value;
      setOverlayOpen(value);
      return;
    }
    const value = typeof next === "function" ? next(dockedRef.current) : next;
    dockedRef.current = value;
    setDocked(value);
    rememberChoice(OUTLINE_OPEN_CHOICE, value);
  }, []);

  const close = useCallback(() => {
    if (!overlayRef.current) return;
    overlayOpenRef.current = false;
    setOverlayOpen(false);
  }, []);

  const mode: OutlineMode = overlay ? "overlay" : "docked";
  return [overlay ? overlayOpen : docked, setOutlineOpen, { mode, close }];
}
