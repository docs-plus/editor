import type { Editor } from "@tiptap/react";

declare global {
  interface Window {
    /** Exposed in dev mode for Playwright E2E tests. */
    __tiptap_editor?: Editor;
    /** Dev-only Playwright hook: React commits that re-rendered the toolbar. */
    __toolbarCommits?: number;
    /** Dev-only Playwright hook: Profiler `actualDuration` of each toolbar update. */
    __toolbarRenderMs?: number[];
    /** Dev-only Playwright hook: set before boot to render without the toolbar. */
    __TOOLBAR_OFF?: boolean;
    /** Dev-only Playwright hook: set before boot to mount comments (dark on the web). */
    __COMMENTS_PERF?: boolean;
    /** Dev-only Playwright hook: load the comments controller and seed threads. */
    __comments?: {
      ready(): Promise<boolean>;
      /** Writes up to `count` threads; returns how many it wrote. */
      seed(count: number): number;
    };
  }
}
