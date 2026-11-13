"use client";

import { useEffect } from "react";

/** Without `requestIdleCallback` (Safari), wait this long after mount. */
const IDLE_FALLBACK_MS = 1500;
/** Fetch by then even on a busy page, so a menu rarely opens before it. */
const IDLE_TIMEOUT_MS = 3000;

/**
 * Owner decision O1: surfaces that are not on screen at first paint (menu
 * bodies, the context slot's controls, Insert steps, the colour popover)
 * are their own chunks. Each is fetched once the page is idle after the
 * editor mounts, and again on its trigger's hover or focus, so a keyboard
 * user almost never opens one before it has loaded. A failed fetch is
 * ignored here: opening the surface imports it again.
 */
export function preloadWhenIdle(
  load: () => Promise<unknown>,
  fallbackMs = IDLE_FALLBACK_MS,
): () => void {
  const run = () => {
    load().catch(() => undefined);
  };
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(run, { timeout: IDLE_TIMEOUT_MS });
    return () => window.cancelIdleCallback?.(id);
  }
  const timer = setTimeout(run, fallbackMs);
  return () => clearTimeout(timer);
}

/** `preloadWhenIdle` for the lifetime of the calling component. */
export function useIdlePreload(load: () => Promise<unknown>): void {
  useEffect(() => preloadWhenIdle(load), [load]);
}
