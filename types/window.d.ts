import type { Editor } from "@tiptap/react";

declare global {
  interface Window {
    /** Exposed in dev mode for Playwright E2E tests. */
    __tiptap_editor?: Editor;
    /** Dev-only Playwright hook: React commits that re-rendered the toolbar. */
    __toolbarCommits?: number;
    /** Dev-only Playwright hook: set before boot to render without the toolbar. */
    __TOOLBAR_OFF?: boolean;
  }
}
