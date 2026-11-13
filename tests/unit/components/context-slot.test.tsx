import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";
import type { Editor as ReactEditor } from "@tiptap/react";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

import { ContextSlot } from "@/components/smart-toolbar/context-slot/context-slot";
import { Toolbar } from "@/components/ui/toolbar";
import { getEditorContextStore } from "@/lib/editor-context/store";

import { createTestEditor } from "../../helpers/create-test-editor";
import { posInside } from "../../helpers/document-builders";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe("ContextSlot hold", () => {
  it("holds while a slot control has focus and releases on unmount", () => {
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
            type: "heading",
            attrs: { level: 2, id: "a" },
            content: [{ type: "text", text: "Alpha" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        ],
      },
    });
    const target = editor;
    target.commands.setTextSelection(posInside(target, "Alpha"));
    const store = getEditorContextStore(target);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act(() => {
      root.render(
        createElement(
          Toolbar,
          null,
          createElement(ContextSlot, {
            editor: target as unknown as ReactEditor,
          }),
        ),
      );
    });
    const group = host.querySelector('[data-slot="context-slot"]');
    expect(group?.getAttribute("aria-label")).toBe("Section tools");
    const button = group?.querySelector("button");
    act(() => button?.focus());

    act(() => {
      target.commands.setTextSelection(posInside(target, "Body"));
    });
    expect(store.getSlotContext().kind).toBe("heading");

    act(() => root.unmount());
    host.remove();
    expect(store.getSlotContext().kind).toBe("paragraph");
    expect(store.getSlotContext()).toBe(store.getContext());
  });
});
