import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { AlignMenu } from "@/components/smart-toolbar/row/align-menu";
import { Toolbar } from "@/components/ui/toolbar";
import { editorActions } from "@/lib/editor-actions";

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

const ALIGNS = ["left", "center", "right", "justify"] as const;

function triggerNameFor(align: (typeof ALIGNS)[number]): string | null {
  editor = createTestEditor({
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          attrs: { textAlign: align },
          content: [{ type: "text", text: "Body" }],
        },
      ],
    },
  });
  editor.commands.setTextSelection(editor.state.doc.content.size - 2);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      createElement(
        Toolbar,
        null,
        createElement(AlignMenu, { editor: editor as never }),
      ),
    );
  });
  return (
    host.querySelector('[role="toolbar"] button')?.getAttribute("aria-label") ??
    null
  );
}

describe("AlignMenu trigger", () => {
  for (const align of ALIGNS) {
    it(`is named by the align.${align} action's label`, () => {
      const label = editorActions.get(`align.${align}`)?.label;
      expect(label).toBeString();
      expect(triggerNameFor(align)).toBe(label as string);
    });
  }

  it("uses one wording everywhere: Align left/center/right, Justify", () => {
    expect(ALIGNS.map((a) => editorActions.get(`align.${a}`)?.label)).toEqual([
      "Align left",
      "Align center",
      "Align right",
      "Justify",
    ]);
  });
});
