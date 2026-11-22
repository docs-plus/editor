"use client";

import {
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { isReadingMode, subscribeReadingMode } from "@/lib/prefs/reading-mode";
import {
  outlineDockMinPx,
  type PageState,
  type PageWidth,
} from "@/lib/prefs/schema";
import { getPrefs, subscribePrefs } from "@/lib/prefs/store-web";

export interface PageFrameState {
  /** Reading mode: the editor takes it as its `readOnly` prop. */
  readOnly: boolean;
  /** Too narrow to dock the outline beside the page (§5.9). */
  outlineOverlay: boolean;
}

const notReading = () => false;

/** A document's own width wins over the default (library hosts only). */
function pageFor(docWidth: PageWidth | undefined): PageState {
  const page = getPrefs().page;
  if (!docWidth || page.style === "classic") return page;
  return { ...page, width: docWidth };
}

/**
 * The page container (preferences design §5.1, §5.9). It owns
 * `data-doc-width` and `data-reading`, and decides whether the outline
 * docks, outside the editor shell, which then re-renders only when one of
 * those two booleans flips:
 * - Docking: the frame (the main area beside any files sidebar) docks the
 *   outline when it is at least the card plus 302 px wide. The card is
 *   computed from the preferences, never measured; a ResizeObserver on the
 *   frame flips the boolean only when the threshold is crossed.
 * - Reading mode: per tab, never stored; the editor becomes read-only and
 *   CSS hides the toolbar.
 * Width and text size changes reach the page through CSS variables only.
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
  const reading = useSyncExternalStore(
    subscribeReadingMode,
    isReadingMode,
    notReading,
  );
  const [outlineOverlay, setOutlineOverlay] = useState(false);

  // Before paint, so a narrow frame never shows a docked outline first.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    let width = frame.getBoundingClientRect().width;
    const update = () => {
      const rootPx =
        Number.parseFloat(
          getComputedStyle(document.documentElement).fontSize,
        ) || 16;
      setOutlineOverlay(width < outlineDockMinPx(pageFor(docWidth), rootPx));
    };
    const observer = new ResizeObserver(([entry]) => {
      width = entry.borderBoxSize?.[0]?.inlineSize ?? entry.contentRect.width;
      update();
    });
    observer.observe(frame);
    update();
    const unsubscribe = subscribePrefs(update);
    return () => {
      observer.disconnect();
      unsubscribe();
    };
  }, [docWidth]);

  return (
    <div
      ref={frameRef}
      className="page-frame"
      data-doc-width={docWidth}
      data-reading={reading || undefined}
    >
      {children({ readOnly: reading, outlineOverlay })}
    </div>
  );
}
