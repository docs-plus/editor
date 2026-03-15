import type { Editor } from "@tiptap/react";

declare global {
  interface Window {
    /** Exposed in dev mode for Playwright E2E tests. */
    __tiptap_editor?: Editor;
  }
}
