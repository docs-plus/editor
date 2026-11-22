import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { InsertSheetBody } from "@/components/smart-toolbar/phone/insert-sheet-body";

import { createTestEditor } from "../../helpers/create-test-editor";

let editor: Editor | undefined;
let root: Root | null = null;
let container: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  editor?.destroy();
  root = null;
});

describe("phone Insert sheet body (A22)", () => {
  it("renders without the loader's helpers instead of throwing", () => {
    editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "paragraph" },
        ],
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    expect(() =>
      act(() =>
        root?.render(
          createElement(InsertSheetBody, {
            editor: editor as never,
            step: null,
            onStep: () => {},
            onDone: () => {},
          } as never),
        ),
      ),
    ).not.toThrow();
  });
});
