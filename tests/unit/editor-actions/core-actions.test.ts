import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, Extension, JSONContent } from "@tiptap/core";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TextSelection } from "@tiptap/pm/state";

import { editorActions } from "@/lib/editor-actions";
import { coreActions } from "@/lib/editor-actions/core-actions";
import { availability, runAction } from "@/lib/editor-actions/registry";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";
import { computeContext } from "@/lib/editor-context/snapshot";

import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";
import { posInside } from "../../helpers/document-builders";

type Marks = JSONContent["marks"];
const t = (text: string, marks?: Marks): JSONContent => ({
  type: "text",
  text,
  ...(marks ? { marks } : {}),
});
const para = (...content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  content,
});
const heading = (level: number, text: string, id: string): JSONContent => ({
  type: "heading",
  attrs: { level, id, "data-toc-id": id },
  content: [t(text)],
});
const TITLE = heading(1, "Title", "title");

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function make(...blocks: JSONContent[]): Editor {
  editor = createTestEditor({
    content: { type: "doc", content: [TITLE, ...blocks] },
    // The app registers both; the shared test editor does not.
    extensions: [...DEFAULT_EXTENSIONS, Superscript, Subscript] as Extension[],
  });
  return editor;
}

function select(target: Editor, from: number, to = from): void {
  target.view.dispatch(
    target.state.tr.setSelection(
      TextSelection.create(target.state.doc, from, to),
    ),
  );
}

function action(id: string) {
  const found = editorActions.get(id);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

const enabledIn = (target: Editor, id: string) =>
  availability(action(id), computeContext(target));

function topLevelTexts(target: Editor): string[] {
  const texts: string[] = [];
  target.state.doc.forEach((node) => {
    texts.push(node.textContent);
  });
  // The trailing-node plugin keeps an empty paragraph at the end.
  return texts.filter(Boolean);
}

describe("core action list", () => {
  it("has a label and one owner prefix per id", () => {
    for (const each of coreActions) {
      expect(each.label.length).toBeGreaterThan(0);
      expect(each.id).toMatch(/^[a-z]+\.[A-Za-z0-9]+$/);
    }
  });

  it("names every reason as a sentence ending in a period", () => {
    const target = make(para(t("x")));
    target.setEditable(false);
    for (const each of coreActions) {
      const view = availability(each, computeContext(target));
      if (view !== true) expect(view.reason.endsWith(".")).toBe(true);
    }
  });

  it("marks exactly the contract's view-only ids mutates:false (§3.1, §4)", () => {
    // section.fold is per-viewer view state (plugin meta, no doc change), so
    // it keeps working in a read-only document (contract amendment A1).
    expect(
      coreActions
        .filter((each) => each.mutates === false)
        .map((each) => each.id)
        .sort(),
    ).toEqual([
      "code.copy",
      "mermaid.copySource",
      "section.fold",
      "view.filter",
      "view.outline",
      "view.theme",
    ]);
  });

  it("refuses every mutating action in a read-only document", () => {
    const target = make(para(t("x")));
    target.setEditable(false);
    const ctx = computeContext(target);
    for (const each of coreActions.filter((a) => a.mutates !== false)) {
      expect(availability(each, ctx)).toEqual({ reason: READ_ONLY_REASON });
    }
  });
});

describe("format.clear (#392)", () => {
  it("removes every inline mark but keeps links, block type, alignment and indent", () => {
    const marks: Marks = [
      { type: "bold" },
      { type: "italic" },
      { type: "hyperlink", attrs: { href: "https://example.com" } },
    ];
    const target = make({
      type: "heading",
      attrs: { level: 2, textAlign: "center", id: "h" },
      content: [t("Styled", marks)],
    });
    const from = posInside(target, "Styled");
    select(target, from, from + 6);
    expect(runAction(target, action("format.clear"))).toBe(true);
    const block = target.state.doc.child(1);
    expect(block.type.name).toBe("heading");
    expect(block.attrs.level).toBe(2);
    expect(block.attrs.textAlign).toBe("center");
    expect(block.textContent).toBe("Styled");
    expect(block.firstChild?.marks.map((mark) => mark.type.name)).toEqual([
      "hyperlink",
    ]);
  });

  it("is one undo step", () => {
    const target = make(
      para(t("Bold", [{ type: "bold" }, { type: "italic" }])),
    );
    const from = posInside(target, "Bold");
    select(target, from, from + 4);
    runAction(target, action("format.clear"));
    target.commands.undo();
    expect(
      target.state.doc.child(1).firstChild?.marks.map((m) => m.type.name),
    ).toEqual(["bold", "italic"]);
  });

  it("is disabled in code", () => {
    const target = make({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [t("let a")],
    });
    select(target, posInside(target, "let"));
    expect(enabledIn(target, "format.clear")).toEqual({
      reason: "Code has no formatting.",
    });
  });
});

describe("marks", () => {
  it("reports active across the range and mixed for part of it", () => {
    const target = make(para(t("Bold", [{ type: "bold" }]), t(" plain")));
    const from = posInside(target, "Bold");
    select(target, from, from + 4);
    const bold = action("mark.bold");
    let ctx = computeContext(target);
    expect(bold.isActive?.(ctx)).toBe(true);
    expect(bold.isMixed?.(ctx)).toBe(false);
    select(target, from, from + 8);
    ctx = computeContext(target);
    expect(bold.isActive?.(ctx)).toBe(false);
    expect(bold.isMixed?.(ctx)).toBe(true);
  });

  it("binds every displayed mark shortcut (#612)", () => {
    const target = make(para(t("word")));
    const from = posInside(target, "word");
    for (const id of [
      "mark.bold",
      "mark.italic",
      "mark.underline",
      "mark.strike",
      "mark.superscript",
      "mark.subscript",
      "mark.inlineCode",
    ]) {
      select(target, from, from + 4);
      const combo = action(id).shortcut as string;
      const before = target.state.doc;
      target.commands.keyboardShortcut(combo);
      expect(target.state.doc).not.toBe(before);
      target.commands.undo();
    }
  });
});

describe("text style", () => {
  it("reads Mixed across a heading and a paragraph", () => {
    const target = make(heading(2, "Head", "a"), para(t("Body")));
    select(target, posInside(target, "Head"), posInside(target, "Body") + 2);
    expect(action("style.paragraph").value?.(computeContext(target))).toBe(
      "Mixed",
    );
  });

  it("is disabled in the title with the PR A copy", () => {
    const target = make(para(t("x")));
    select(target, posInside(target, "Title"));
    expect(enabledIn(target, "style.heading2")).toEqual({
      reason: "Title is always H1.",
    });
  });

  it("converts a mixed heading and paragraph range (Mixed label)", () => {
    const target = make(heading(2, "Head", "a"), para(t("Body")));
    const from = posInside(target, "Head");
    const to = posInside(target, "Body") + 2;
    select(target, from, to);
    expect(enabledIn(target, "style.heading2")).toBe(true);
    expect(runAction(target, action("style.heading2"))).toBe(true);
    const types: string[] = [];
    target.state.doc.forEach((node) => {
      if (node.textContent) {
        types.push(`${node.type.name}${node.attrs.level ?? ""}`);
      }
    });
    expect(types).toEqual(["heading1", "heading2", "heading2"]);
    // The range stays selected after the conversion.
    expect(target.state.selection.empty).toBe(false);
  });

  it("does nothing when every selected block already has the style", () => {
    const target = make(heading(2, "One", "a"), heading(2, "Two", "b"));
    select(target, posInside(target, "One"), posInside(target, "Two") + 2);
    const before = target.state.doc;
    expect(runAction(target, action("style.heading2"))).toBe(false);
    expect(target.state.doc).toBe(before);
  });

  it("is disabled for a range that starts in the title", () => {
    const target = make(para(t("Body")));
    select(target, posInside(target, "Title"), posInside(target, "Body") + 2);
    expect(enabledIn(target, "style.heading2")).toEqual({
      reason: "Title is always H1.",
    });
    // Head in the title, anchor in the body: the range still starts there.
    select(target, posInside(target, "Body") + 2, posInside(target, "Title"));
    expect(enabledIn(target, "style.paragraph")).toEqual({
      reason: "Title is always H1.",
    });
    const before = target.state.doc;
    expect(runAction(target, action("style.paragraph"))).toBe(false);
    expect(target.state.doc).toBe(before);
  });

  it("sets a heading level in one step", () => {
    const target = make(para(t("Body")));
    select(target, posInside(target, "Body"));
    expect(runAction(target, action("style.heading3"))).toBe(true);
    expect(target.state.doc.child(1).type.name).toBe("heading");
    expect(target.state.doc.child(1).attrs.level).toBe(3);
  });
});

describe("indent mirrors Tab", () => {
  const item = (text: string): JSONContent => ({
    type: "listItem",
    content: [para(t(text))],
  });

  it("sinks the second list item and outdent lifts it back", () => {
    const target = make({
      type: "bulletList",
      content: [item("one"), item("two")],
    });
    select(target, posInside(target, "two"));
    expect(enabledIn(target, "indent.indent")).toBe(true);
    expect(runAction(target, action("indent.indent"))).toBe(true);
    const list = target.state.doc.child(1);
    expect(list.childCount).toBe(1);
    expect(runAction(target, action("indent.outdent"))).toBe(true);
    expect(target.state.doc.child(1).childCount).toBe(2);
  });

  it("indents a paragraph and says why outdent cannot run", () => {
    const target = make(para(t("Body")));
    select(target, posInside(target, "Body"));
    expect(enabledIn(target, "indent.outdent")).toEqual({
      reason: "Nothing to outdent here.",
    });
    expect(runAction(target, action("indent.indent"))).toBe(true);
    // Text indent inserts the indent characters, like Tab.
    expect(target.state.doc.child(1).textContent).toBe("  Body");
  });
});

describe("align", () => {
  it("sets and reads alignment", () => {
    const target = make(para(t("Body")));
    select(target, posInside(target, "Body"));
    expect(runAction(target, action("align.center"))).toBe(true);
    expect(action("align.center").isActive?.(computeContext(target))).toBe(
      true,
    );
  });
});

describe("sections", () => {
  const doc = () =>
    make(
      heading(2, "Alpha", "a"),
      para(t("a body")),
      heading(3, "Alpha sub", "a1"),
      heading(2, "Beta", "b"),
      para(t("b body")),
    );

  it("moves a section up past a deeper subsection, in one undo step", () => {
    const target = doc();
    select(target, posInside(target, "Beta"));
    expect(runAction(target, action("section.moveUp"))).toBe(true);
    expect(topLevelTexts(target)).toEqual([
      "Title",
      "Beta",
      "b body",
      "Alpha",
      "a body",
      "Alpha sub",
    ]);
    target.commands.undo();
    expect(topLevelTexts(target)[1]).toBe("Alpha");
  });

  it("moves a section down below its next sibling", () => {
    const target = doc();
    select(target, posInside(target, "Alpha"));
    expect(runAction(target, action("section.moveDown"))).toBe(true);
    expect(topLevelTexts(target).slice(1, 3)).toEqual(["Beta", "b body"]);
  });

  it("explains the edges", () => {
    const target = doc();
    select(target, posInside(target, "Alpha"));
    expect(enabledIn(target, "section.moveUp")).toEqual({
      reason: "Already first at this level.",
    });
    select(target, posInside(target, "Alpha sub"));
    expect(enabledIn(target, "section.moveUp")).toEqual({
      reason: "Already first at this level.",
    });
    select(target, posInside(target, "Beta"));
    expect(enabledIn(target, "section.moveDown")).toEqual({
      reason: "Already last at this level.",
    });
  });

  it("refuses to move another section when the held heading is gone", () => {
    const target = make(
      heading(2, "Alpha", "a"),
      heading(2, "Gamma", "g"),
      heading(2, "Beta", "b"),
      heading(2, "Delta", "d"),
    );
    select(target, posInside(target, "Beta"));
    // A collaborator deletes "Beta"; the caret maps into a heading that
    // could move up, so only the held id stops the wrong move.
    const start = posInside(target, "Beta") - 1;
    const beta = target.state.doc.nodeAt(start);
    target.view.dispatch(
      target.state.tr.delete(start, start + (beta?.nodeSize ?? 0)),
    );
    expect(computeContext(target).headingLevel).toBe(2);
    const before = topLevelTexts(target);
    expect(runAction(target, action("section.moveUp"), "b")).toBe(false);
    expect(runAction(target, action("section.moveUp"), null)).toBe(false);
    expect(topLevelTexts(target)).toEqual(before);
    // Control: without a held id the caret's heading moves.
    expect(runAction(target, action("section.moveUp"))).toBe(true);
    expect(topLevelTexts(target)).not.toEqual(before);
  });
});

describe("code", () => {
  it("sets only allow-listed languages and turns a diagram into code", () => {
    const target = make({
      type: "codeBlock",
      attrs: { language: "mermaid" },
      content: [t("graph TD")],
    });
    select(target, posInside(target, "graph"));
    expect(computeContext(target).kind).toBe("mermaid");
    expect(runAction(target, action("mermaid.language"), "js onerror=x")).toBe(
      false,
    );
    expect(runAction(target, action("mermaid.language"), "typescript")).toBe(
      true,
    );
    expect(computeContext(target).kind).toBe("code");
    expect(action("code.language").value?.(computeContext(target))).toBe(
      "TypeScript",
    );
  });
});
