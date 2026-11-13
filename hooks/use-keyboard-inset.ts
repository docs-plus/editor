"use client";

import { useEffect, useState } from "react";

interface ViewportGeometry {
  height: number;
  offsetTop: number;
}

/**
 * Pixels of the layout viewport hidden under the on-screen keyboard: what
 * the visual viewport leaves uncovered at the bottom. 0 without a visual
 * viewport (old browsers) or when it is taller (pinch zoom out).
 */
export function keyboardInset(
  innerHeight: number,
  viewport: ViewportGeometry | null | undefined,
): number {
  if (!viewport) return 0;
  return Math.max(
    0,
    Math.round(innerHeight - viewport.height - viewport.offsetTop),
  );
}

/** Focus can stay in these without closing the keyboard. */
function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}

/**
 * The on-screen keyboard's height, for docking the phone bar above it
 * (spec §4.7). Recomputed at most once per frame on `visualViewport`
 * `resize` and `scroll`. iOS can leave the visual viewport offset after the
 * keyboard closes, so focus leaving editable content resets it to 0 after
 * one frame. Every listener is removed on unmount.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        setInset(keyboardInset(window.innerHeight, viewport)),
      );
    };
    const onFocusOut = (event: FocusEvent) => {
      if (isEditable(event.relatedTarget)) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setInset(0));
    };
    setInset(keyboardInset(window.innerHeight, viewport));
    viewport.addEventListener("resize", measure);
    viewport.addEventListener("scroll", measure);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", measure);
      viewport.removeEventListener("scroll", measure);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return inset;
}
