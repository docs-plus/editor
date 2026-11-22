"use client";

import { type ReactNode, useLayoutEffect, useRef, useState } from "react";

import type { PageWidth } from "@/lib/prefs/page-metrics";

export interface PageFrameState {
  /** Reading mode (`data-reading`): the editor takes it as `readOnly`. */
  readOnly: boolean;
  /** Too narrow to dock the outline beside the page (§5.9). */
  outlineOverlay: boolean;
}

const INITIAL: PageFrameState = { readOnly: false, outlineOverlay: false };

/**
 * Loads the preferences runtime (`lib/prefs/runtime.ts`) once, when the
 * page is idle: until a preference changes, the boot script's attributes
 * are already right, so the first load carries none of the store. Started
 * from the frame, so pages without a document never load it.
 */
let runtimeStarted = false;
function startRuntime(): void {
  if (runtimeStarted) return;
  runtimeStarted = true;
  const load = () =>
    import("@/lib/prefs/runtime").then((module) => module.startPrefsRuntime());
  if ("requestIdleCallback" in window) requestIdleCallback(load);
  else setTimeout(load, 200);
}

/** The `<html>` attributes that move the threshold or reading mode. */
const WATCHED = [
  "data-page-style",
  "data-text-size",
  "data-page-width",
  "data-reading",
];

/**
 * The page container (preferences design §5.1, §5.9). It decides, outside
 * the editor shell, whether the outline docks and whether the document is
 * read-only, and passes both down; the shell re-renders only when one of
 * them flips.
 * - Docking: the frame (the main area beside any files sidebar) docks the
 *   outline when it is at least the card plus 302 px wide. CSS computes
 *   that from the same variables as the card (`--page-dock-min`), never
 *   from a measured card. A ResizeObserver on the frame and a
 *   MutationObserver on `<html>` re-check it; it runs before paint, so a
 *   narrow frame never shows a docked outline.
 * - Reading mode: `data-reading` on `<html>`, per tab, never stored.
 * It reads CSS and attributes only, so the first load carries none of the
 * preferences store; it starts the lazy runtime once the page is idle.
 */
export function PageFrame({
  docWidth,
  children,
}: {
  /** This document's own width (library hosts), else the default. */
  docWidth?: PageWidth;
  children: (state: PageFrameState) => ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState(INITIAL);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const root = document.documentElement;
    let width = frame.getBoundingClientRect().width;
    const update = () => {
      const readOnly = root.hasAttribute("data-reading");
      // `--page-dock-min` (`_page.scss`), computed to px; a browser
      // without `@property` keeps today's 950 px.
      const dockMin =
        Number.parseFloat(
          getComputedStyle(frame).getPropertyValue("--page-dock-min"),
        ) || 950;
      const outlineOverlay = width < dockMin;
      setState((current) =>
        current.readOnly === readOnly &&
        current.outlineOverlay === outlineOverlay
          ? current
          : { readOnly, outlineOverlay },
      );
    };
    const resize = new ResizeObserver(([entry]) => {
      width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      update();
    });
    const attributes = new MutationObserver(update);
    resize.observe(frame);
    attributes.observe(root, { attributeFilter: WATCHED });
    update();
    startRuntime();
    return () => {
      resize.disconnect();
      attributes.disconnect();
    };
  }, [docWidth]);

  return (
    <div ref={frameRef} className="page-frame" data-doc-width={docWidth}>
      {children(state)}
    </div>
  );
}
