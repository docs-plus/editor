import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";

import {
  CODE_LANGUAGE_CHOICE,
  CODE_LANGUAGES,
  isRememberedCodeLanguage,
  mostUsedCodeLanguage,
  suggestedCodeLanguage,
} from "@/lib/code-language";
import { editorActions } from "@/lib/editor-actions";
import { runAction } from "@/lib/editor-actions/registry";
import { readChoice, rememberChoice } from "@/lib/remembered-choice";

import { createTestEditor } from "../../helpers/create-test-editor";

const title: JSONContent = {
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text: "Title" }],
};
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});
const code = (language: string | null, text = "x"): JSONContent => ({
  type: "codeBlock",
  attrs: { language },
  content: [{ type: "text", text }],
});

let editor: Editor;

function open(content: JSONContent[]) {
  editor = createTestEditor({ content: { type: "doc", content } });
}

const run = (id: string, arg?: unknown) => {
  const action = editorActions.get(id);
  if (!action) throw new Error(`No action ${id}`);
  return runAction(editor, action, arg);
};

/** Puts the caret inside the first text of the given top-level block. */
function caretIn(index: number) {
  let pos = 0;
  for (let i = 0; i < index; i += 1) pos += editor.state.doc.child(i).nodeSize;
  let inner = pos;
  editor.state.doc.nodesBetween(
    pos,
    pos + editor.state.doc.child(index).nodeSize,
    (node, at) => {
      if (inner === pos && node.isTextblock) inner = at + 1;
    },
  );
  editor.commands.setTextSelection(inner + 1);
}

beforeEach(() => localStorage.clear());
afterEach(() => editor?.destroy());

describe("M4: code language memory", () => {
  it("lists the languages here, Mermaid included", () => {
    expect(CODE_LANGUAGES.some((option) => option.value === "mermaid")).toBe(
      true,
    );
  });

  it("allowlists known languages except Mermaid", () => {
    expect(isRememberedCodeLanguage("python")).toBe(true);
    expect(isRememberedCodeLanguage("mermaid")).toBe(false);
    expect(isRememberedCodeLanguage("evil class")).toBe(false);
    expect(isRememberedCodeLanguage("__proto__")).toBe(false);
  });

  it("finds the most used language in the doc, ignoring Mermaid", () => {
    open([
      title,
      code("mermaid"),
      code("mermaid"),
      code("mermaid"),
      code("python"),
      code("rust"),
      code("python"),
      code(null),
    ]);
    expect(mostUsedCodeLanguage(editor.state.doc)).toBe("python");
  });

  it("breaks a tie by the first language in the doc", () => {
    open([title, code("rust"), code("python")]);
    expect(mostUsedCodeLanguage(editor.state.doc)).toBe("rust");
  });

  it("has no suggestion in a doc without code and no memory", () => {
    open([title, paragraph("hello")]);
    expect(suggestedCodeLanguage(editor.state.doc)).toBeNull();
  });

  it("falls back to your last language", () => {
    rememberChoice(CODE_LANGUAGE_CHOICE, "go");
    open([title, paragraph("hello")]);
    expect(suggestedCodeLanguage(editor.state.doc)).toBe("go");
  });

  it("prefers the doc's most used language over your last", () => {
    rememberChoice(CODE_LANGUAGE_CHOICE, "go");
    open([title, code("sql"), paragraph("hello")]);
    expect(suggestedCodeLanguage(editor.state.doc)).toBe("sql");
  });

  it("code.language writes the choice when it applies", () => {
    open([title, code(null)]);
    caretIn(1);
    expect(run("code.language", "typescript")).toBe(true);
    expect(readChoice(CODE_LANGUAGE_CHOICE).last).toBe("typescript");
  });

  it("insert.codeBlock uses the suggested language", () => {
    open([title, code("sql"), paragraph("hello")]);
    caretIn(2);
    expect(run("insert.codeBlock")).toBe(true);
    expect(editor.state.doc.child(2).type.name).toBe("codeBlock");
    expect(editor.state.doc.child(2).attrs.language).toBe("sql");
  });

  it("insert.codeBlock stays plain with nothing to suggest", () => {
    open([title, paragraph("hello")]);
    caretIn(1);
    expect(run("insert.codeBlock")).toBe(true);
    expect(editor.state.doc.child(1).attrs.language ?? null).toBeNull();
  });
});
