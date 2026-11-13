import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { InsertMenu } from "@/components/smart-toolbar/insert-menu";
import { Toolbar } from "@/components/ui/toolbar";
import { ToolbarButton } from "@/components/ui/toolbar-button";

import { createTestEditor } from "../../helpers/create-test-editor";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
let editor: Editor | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  editor?.destroy();
  root = null;
  host = null;
  editor = null;
});

describe("InsertMenu in the toolbar", () => {
  it("adds only the Insert button, with no hidden focusable anchor", () => {
    editor = createTestEditor({});
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        createElement(
          Toolbar,
          null,
          createElement(ToolbarButton, { "aria-label": "Bold" }),
          createElement(InsertMenu, { editor: editor as never }),
        ),
      );
    });
    const toolbar = host.querySelector('[role="toolbar"]');
    const hiddenFocusable = toolbar?.querySelectorAll(
      '[aria-hidden="true"][tabindex]:not([tabindex="-1"])',
    );
    expect(hiddenFocusable?.length).toBe(0);
    // The toolbar's roving items: Bold and Insert, nothing else.
    const items = toolbar?.querySelectorAll(
      'button, [role="button"], [tabindex="0"]',
    );
    expect(
      Array.from(items ?? []).map((el) => el.getAttribute("aria-label")),
    ).toEqual(["Bold", "Insert"]);
  });
});
