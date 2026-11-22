"use client";

import { useEffect, useSyncExternalStore } from "react";

/**
 * The on-screen keyboard, measured once for the whole page (phones and
 * tablets design §4.6): one `visualViewport` listener set, shared by every
 * subscriber and removed with the last one. While anything subscribes,
 * `<html>` carries `--keyboard-inset` (the keyboard's height) and
 * `--visual-viewport-height`, written at most once per frame, so CSS-only
 * consumers (bottom sheets) ride the keyboard without re-rendering. With no
 * subscriber both are removed and CSS falls back to 0.
 *
 * Works the same on iOS Safari and Android Chrome: both shrink the visual
 * viewport, not the layout viewport, under the keyboard (Chrome's default
 * `interactive-widget=resizes-visual`). No VirtualKeyboard API.
 */

/** The keyboard's height in px, on `<html>` while subscribed. */
export const KEYBOARD_INSET_VAR = "--keyboard-inset";
/** The visual viewport's height in px: a sheet's `max-height` above the keyboard. */
export const VISUAL_VIEWPORT_HEIGHT_VAR = "--visual-viewport-height";

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

const insetListeners = new Set<() => void>();
const widthListeners = new Set<() => void>();
let users = 0;
let detach: (() => void) | null = null;
let inset = 0;
let viewportHeight = 0;
let layoutWidth = 0;
let frame = 0;

/** Writes what changed and tells the subscribers if the inset did. */
function apply(nextInset: number, nextHeight: number, force = false): void {
  const style = document.documentElement.style;
  if (force || nextHeight !== viewportHeight) {
    viewportHeight = nextHeight;
    style.setProperty(VISUAL_VIEWPORT_HEIGHT_VAR, `${nextHeight}px`);
  }
  if (!force && nextInset === inset) return;
  inset = nextInset;
  style.setProperty(KEYBOARD_INSET_VAR, `${nextInset}px`);
  for (const listener of insetListeners) listener();
}

function measure(viewport: VisualViewport, force = false): void {
  apply(
    keyboardInset(window.innerHeight, viewport),
    Math.round(viewport.height),
    force,
  );
}

function nextFrame(task: () => void): void {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(task);
}

/**
 * Adds the one listener set. iOS can leave the visual viewport offset after
 * the keyboard closes, so focus leaving editable content resets the inset
 * to 0 after one frame. A changed layout width (rotation, iPad window
 * resize) is reported once the frame settles; pinch zoom and the keyboard
 * change only the visual viewport.
 */
function attach(): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  layoutWidth = window.innerWidth;
  const settle = () => {
    measure(viewport);
    if (window.innerWidth === layoutWidth) return;
    layoutWidth = window.innerWidth;
    for (const listener of widthListeners) listener();
  };
  const onChange = () => nextFrame(settle);
  const onFocusOut = (event: FocusEvent) => {
    if (isEditable(event.relatedTarget)) return;
    nextFrame(() => apply(0, window.innerHeight));
  };
  measure(viewport, true);
  viewport.addEventListener("resize", onChange);
  viewport.addEventListener("scroll", onChange);
  document.addEventListener("focusout", onFocusOut);
  return () => {
    cancelAnimationFrame(frame);
    viewport.removeEventListener("resize", onChange);
    viewport.removeEventListener("scroll", onChange);
    document.removeEventListener("focusout", onFocusOut);
    const style = document.documentElement.style;
    style.removeProperty(KEYBOARD_INSET_VAR);
    style.removeProperty(VISUAL_VIEWPORT_HEIGHT_VAR);
    inset = 0;
    viewportHeight = 0;
  };
}

/** Holds the listener set until the returned release runs (once). */
function retain(): () => void {
  users += 1;
  if (users === 1) detach = attach();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    users -= 1;
    if (users > 0) return;
    detach?.();
    detach = null;
  };
}

/** `useSyncExternalStore` subscribe: `listener` runs when the inset changes. */
export function subscribeKeyboardInset(listener: () => void): () => void {
  insetListeners.add(listener);
  const release = retain();
  return () => {
    insetListeners.delete(listener);
    release();
  };
}

/** The keyboard's height in px; 0 with no subscriber. */
export function getKeyboardInset(): number {
  return inset;
}

const getServerInset = () => 0;

/**
 * Runs `listener` after the layout width changes (rotation), once the
 * frame has settled. It holds the listener set like any subscriber.
 */
export function onViewportWidthChange(listener: () => void): () => void {
  const entry = () => listener();
  widthListeners.add(entry);
  const release = retain();
  return () => {
    widthListeners.delete(entry);
    release();
  };
}

/** The on-screen keyboard's height, for docking the phone bar above it. */
export function useKeyboardInset(): number {
  return useSyncExternalStore(
    subscribeKeyboardInset,
    getKeyboardInset,
    getServerInset,
  );
}

/** Keeps the CSS variables live while mounted, without re-rendering. */
export function useKeyboardInsetVars(): void {
  useEffect(() => retain(), []);
}
