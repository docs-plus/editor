import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";

import {
  getTextStyleValue,
  setTextStyle,
} from "@/components/tiptap-ui/heading-dropdown-menu/use-heading-dropdown-menu";
import {
  getListValue,
  setListType,
} from "@/components/tiptap-ui/list-dropdown-menu/use-list-dropdown-menu";

import { createTestEditor } from "../../helpers/create-test-editor";
import { doc, h1, h2, p, posInside } from "../../helpers/document-builders";

let editor: Editor;

function setup() {
  editor = createTestEditor({
    content: doc(h1("Title"), h2("Section"), p("Body")).toJSON(),
  });
}

afterEach(() => editor?.destroy());

describe("text style", () => {
  it("reads Title in the first block and Heading 2 in a level-2 heading", () => {
    setup();
    editor.commands.setTextSelection(2);
    expect(getTextStyleValue(editor)).toBe("title");
    editor.commands.setTextSelection(posInside(editor, "Section"));
    expect(getTextStyleValue(editor)).toBe("heading-2");
    editor.commands.setTextSelection(posInside(editor, "Body"));
    expect(getTextStyleValue(editor)).toBe("paragraph");
  });

  it("sets, never toggles, the text style", () => {
    setup();
    editor.commands.setTextSelection(posInside(editor, "Section"));
    expect(setTextStyle(editor, "heading-2")).toBe(false);
    expect(getTextStyleValue(editor)).toBe("heading-2");
    expect(setTextStyle(editor, "paragraph")).toBe(true);
    expect(getTextStyleValue(editor)).toBe("paragraph");
    expect(setTextStyle(editor, "heading-3")).toBe(true);
    expect(getTextStyleValue(editor)).toBe("heading-3");
  });

  it("leaves the title alone", () => {
    setup();
    editor.commands.setTextSelection(2);
    expect(setTextStyle(editor, "paragraph")).toBe(false);
    expect(getTextStyleValue(editor)).toBe("title");
  });
});

describe("list type", () => {
  it("switches and removes lists without toggling", () => {
    setup();
    editor.commands.setTextSelection(posInside(editor, "Body"));
    expect(setListType(editor, "bulletList")).toBe(true);
    expect(setListType(editor, "bulletList")).toBe(false);
    expect(setListType(editor, "orderedList")).toBe(true);
    expect(getListValue(editor)).toBe("orderedList");
    expect(setListType(editor, "none")).toBe(true);
    expect(getListValue(editor)).toBe("none");
    expect(setListType(editor, "none")).toBe(false);
  });
});
