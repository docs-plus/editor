import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import { GENERIC_MARK_REASONS } from "@/components/smart-toolbar/bubble/bubble-action-button";
import { editorActions } from "@/lib/editor-actions";
import { availability } from "@/lib/editor-actions/registry";
import { computeContext } from "@/lib/editor-context/snapshot";

import { createTestEditor } from "../../helpers/create-test-editor";
import { posInside } from "../../helpers/document-builders";

let editor: Editor;
afterEach(() => editor?.destroy());

describe("bubble inline code reason (spec §7.2)", () => {
  it("replaces exactly the registry's generic refusals inside inline code", () => {
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
            content: [
              { type: "text", text: "code", marks: [{ type: "inlineCode" }] },
              { type: "text", text: " tail" },
            ],
          },
        ],
      },
    });
    const from = posInside(editor, "code");
    editor.view.dispatch(
      editor.state.tr.setSelection(
        TextSelection.create(editor.state.doc, from, from + 4),
      ),
    );
    const ctx = computeContext(editor);
    const reasons = new Set<string>();
    for (const id of [
      "mark.bold",
      "mark.italic",
      "mark.underline",
      "mark.strike",
      "mark.link",
      "color.text.apply",
    ]) {
      const action = editorActions.get(id);
      if (!action) throw new Error(`missing ${id}`);
      const enabled = availability(action, ctx);
      expect(enabled, id).not.toBe(true);
      if (enabled !== true) reasons.add(enabled.reason);
    }
    // Every refusal in inline code is one the bubble rewrites, and the copy
    // names nothing the registry no longer says.
    expect([...reasons].every((r) => GENERIC_MARK_REASONS.has(r))).toBe(true);
    expect(reasons).toEqual(new Set(GENERIC_MARK_REASONS));
  });
});
