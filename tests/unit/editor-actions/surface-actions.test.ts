import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";

import { availability, runAction } from "@/lib/editor-actions/registry";
import { surfaceActions } from "@/lib/editor-actions/surface-actions";
import { READ_ONLY_REASON } from "@/lib/editor-actions/types";
import { onUiIntent, type UiIntent } from "@/lib/editor-actions/ui-intents";
import { computeContext } from "@/lib/editor-context/snapshot";
import {
  HIGHLIGHT_CHOICE,
  INSERT_KIND_CHOICE,
  RECENT_COLORS_CHOICE,
  readChoice,
  rememberChoice,
  STORAGE_KEYS,
  TABLE_SIZE_CHOICE,
  TEXT_COLOR_CHOICE,
} from "@/lib/remembered-choice";

import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";

/** PR C's real `textColor` / `fontSize` marks are in the default chain. */
const WITH_MARKS = DEFAULT_EXTENSIONS;

/** The chain without PR C's marks: an older client's schema. */
const WITHOUT_MARKS = DEFAULT_EXTENSIONS.filter(
  (ext) => ext.name !== "textColor" && ext.name !== "fontSize",
);

const DOC = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "hello world" }] },
  ],
};

let editor: Editor;

function getAction(id: string) {
  const action = surfaceActions.find((candidate) => candidate.id === id);
  if (!action) throw new Error(`No action ${id}`);
  return action;
}

/** Selects "hello" in the paragraph. */
function selectHello(target = editor) {
  target.commands.setTextSelection({ from: 8, to: 13 });
}

const marksOn = (name: string) => {
  const node = editor.state.doc.child(1).firstChild;
  return node?.marks.filter((mark) => mark.type.name === name) ?? [];
};

const run = (id: string, arg?: unknown) =>
  runAction(editor, getAction(id), arg);

beforeEach(() => {
  localStorage.clear();
  editor = createTestEditor({ content: DOC, extensions: WITH_MARKS });
  selectHello();
});
afterEach(() => editor.destroy());

describe("surface action ids", () => {
  it("registers exactly the contract's D2 ids", () => {
    expect(surfaceActions.map((action) => action.id)).toEqual([
      "color.text.apply",
      "color.text.unset",
      "color.highlight.apply",
      "color.highlight.unset",
      "size.increase",
      "size.decrease",
      "size.set",
      "insert.image",
      "insert.embed",
      "insert.table",
      "insert.quote",
      "insert.codeBlock",
      "insert.mermaid",
      "insert.divider",
      "memory.forget",
    ]);
  });

  it("labels in sentence case and gives every insert the insert group", () => {
    for (const action of surfaceActions) {
      expect(action.label[0]).toBe(action.label[0].toUpperCase());
      if (action.id.startsWith("insert.")) expect(action.group).toBe("insert");
    }
  });
});

describe("text colour", () => {
  it("applies a token, remembers it as last and recent", () => {
    expect(run("color.text.apply", "blue")).toBe(true);
    expect(marksOn("textColor")[0]?.attrs.color).toBe("blue");
    expect(readChoice(TEXT_COLOR_CHOICE).last).toBe("blue");
    expect(readChoice(RECENT_COLORS_CHOICE).recent).toEqual([
      { kind: "text", token: "blue" },
    ]);
  });

  it("is one undo step", () => {
    run("color.text.apply", "blue");
    editor.commands.undo();
    expect(marksOn("textColor")).toEqual([]);
  });

  it("refuses an invalid token and writes no memory", () => {
    expect(run("color.text.apply", "red;background:url(x)")).toBe(false);
    expect(run("color.text.apply", undefined)).toBe(false);
    expect(marksOn("textColor")).toEqual([]);
    expect(localStorage.getItem(STORAGE_KEYS.choices)).toBeNull();
  });

  it("reports the current colour as its value, and unsets it", () => {
    run("color.text.apply", "green");
    selectHello();
    const ctx = computeContext(editor);
    expect(getAction("color.text.apply").value?.(ctx)).toBe("Green");
    expect(getAction("color.text.apply").isActive?.(ctx)).toBe(true);
    expect(run("color.text.unset")).toBe(true);
    expect(marksOn("textColor")).toEqual([]);
    expect(readChoice(TEXT_COLOR_CHOICE).last).toBe("green");
  });

  it("is disabled with a reason, not thrown, before the mark exists", () => {
    const old = createTestEditor({ content: DOC, extensions: WITHOUT_MARKS });
    selectHello(old);
    const enabled = availability(
      getAction("color.text.apply"),
      computeContext(old),
    );
    expect(enabled).toEqual({ reason: "Text colour isn't available here." });
    expect(runAction(old, getAction("color.text.apply"), "red")).toBe(false);
    old.destroy();
  });

  it("is refused centrally in a read-only document", () => {
    editor.setEditable(false);
    expect(
      availability(getAction("color.text.apply"), computeContext(editor)),
    ).toEqual({ reason: READ_ONLY_REASON });
    expect(run("color.text.apply", "red")).toBe(false);
    expect(marksOn("textColor")).toEqual([]);
  });
});

describe("highlight", () => {
  it("applies a token highlight and remembers it", () => {
    expect(run("color.highlight.apply", "purple")).toBe(true);
    expect(marksOn("highlight")[0]?.attrs.color).toBe("purple");
    expect(readChoice(HIGHLIGHT_CHOICE).last).toBe("purple");
    expect(readChoice(RECENT_COLORS_CHOICE).recent[0]).toEqual({
      kind: "highlight",
      token: "purple",
    });
  });

  it("reads a legacy highlight value as its token", () => {
    editor
      .chain()
      .setHighlight({ color: "var(--tt-color-highlight-red)" })
      .run();
    selectHello();
    expect(
      getAction("color.highlight.apply").value?.(computeContext(editor)),
    ).toBe("Red");
  });

  it("refuses a raw CSS value", () => {
    expect(run("color.highlight.apply", "#ff0000")).toBe(false);
    expect(marksOn("highlight")).toEqual([]);
  });

  it("removes the highlight", () => {
    run("color.highlight.apply", "purple");
    selectHello();
    expect(run("color.highlight.unset")).toBe(true);
    expect(marksOn("highlight")).toEqual([]);
  });
});

describe("font size", () => {
  const sizeValue = () =>
    getAction("size.set").value?.(computeContext(editor)) ?? null;

  it("steps up and down the ladder", () => {
    expect(sizeValue()).toBe("md");
    expect(run("size.increase")).toBe(true);
    selectHello();
    expect(sizeValue()).toBe("lg");
    expect(run("size.increase")).toBe(true);
    selectHello();
    expect(sizeValue()).toBe("xl");
    expect(
      availability(getAction("size.increase"), computeContext(editor)),
    ).toEqual({ reason: "Already the largest size." });
    run("size.decrease");
    selectHello();
    run("size.decrease");
    selectHello();
    expect(sizeValue()).toBe("md");
    expect(marksOn("fontSize")).toEqual([]);
  });

  it("sets a step and removes the mark for M", () => {
    expect(run("size.set", "xs")).toBe(true);
    selectHello();
    expect(marksOn("fontSize")[0]?.attrs.size).toBe("xs");
    expect(
      availability(getAction("size.decrease"), computeContext(editor)),
    ).toEqual({ reason: "Already the smallest size." });
    expect(run("size.set", "md")).toBe(true);
    expect(marksOn("fontSize")).toEqual([]);
    expect(run("size.set", "huge")).toBe(false);
  });

  it("reports a mixed selection", () => {
    editor.commands.setTextSelection({ from: 8, to: 10 });
    run("size.set", "lg");
    editor.commands.setTextSelection({ from: 8, to: 19 });
    expect(getAction("size.set").isMixed?.(computeContext(editor))).toBe(true);
  });

  it("is disabled in headings", () => {
    editor.commands.setTextSelection(3);
    const ctx = computeContext(editor);
    for (const id of ["size.set", "size.increase", "size.decrease"]) {
      expect(availability(getAction(id), ctx)).toEqual({
        reason: "Headings scale automatically.",
      });
    }
  });
});

describe("insert", () => {
  beforeEach(() => editor.commands.setTextSelection(19));

  it("inserts a table of the given size and remembers it", () => {
    expect(run("insert.table", { rows: 2, cols: 4 })).toBe(true);
    const table = editor.state.doc.child(2);
    expect(table.type.name).toBe("table");
    expect(table.childCount).toBe(2);
    expect(table.firstChild?.childCount).toBe(4);
    expect(readChoice(TABLE_SIZE_CHOICE).last).toEqual({ rows: 2, cols: 4 });
    expect(readChoice(INSERT_KIND_CHOICE).last).toBe("table");
  });

  it("asks the shell for a size when none is given, writing nothing", () => {
    const seen: UiIntent[] = [];
    const off = onUiIntent(editor, (intent) => {
      seen.push(intent);
      return intent.type === "insert.open";
    });
    expect(run("insert.table")).toBe(true);
    expect(run("insert.table", { rows: 0, cols: 99 })).toBe(true);
    expect(seen).toEqual([
      { type: "insert.open", kind: "table" },
      { type: "insert.open", kind: "table" },
    ]);
    expect(localStorage.getItem(STORAGE_KEYS.choices)).toBeNull();
    off();
    expect(run("insert.table")).toBe(false);
  });

  it("asks the shell for an embed link", () => {
    const off = onUiIntent(editor, (intent) => intent.type === "insert.open");
    expect(run("insert.embed")).toBe(true);
    off();
  });

  it("inserts a divider, a quote and a code block", () => {
    expect(run("insert.divider")).toBe(true);
    expect(editor.state.doc.child(2).type.name).toBe("horizontalRule");
    editor.commands.setTextSelection(10);
    expect(run("insert.quote")).toBe(true);
    expect(editor.state.doc.child(1).type.name).toBe("blockquote");
    expect(readChoice(INSERT_KIND_CHOICE).last).toBe("quote");
  });

  it("never unwraps a quote: refused inside one, and no pressed state", () => {
    editor.commands.setTextSelection(10);
    expect(run("insert.quote")).toBe(true);
    const quote = getAction("insert.quote");
    expect(quote.isActive).toBeUndefined();
    const inside = availability(quote, computeContext(editor));
    expect(inside).toEqual({ reason: "Already in a quote." });
    expect(run("insert.quote")).toBe(false);
    expect(editor.state.doc.child(1).type.name).toBe("blockquote");
  });

  it("is not offered in the title", () => {
    editor.commands.setTextSelection(3);
    expect(
      availability(getAction("insert.divider"), computeContext(editor)),
    ).not.toBe(true);
  });
});

describe("forget my choices", () => {
  it("clears remembered choices, even in a read-only document", () => {
    rememberChoice(TEXT_COLOR_CHOICE, "blue");
    editor.setEditable(false);
    expect(run("memory.forget")).toBe(true);
    expect(readChoice(TEXT_COLOR_CHOICE).last).toBe("red");
  });
});

describe("selection mark walk (typing-perf path)", () => {
  const PARAGRAPHS = 1000;
  const SELECTION_VIEWS = [
    "color.text.apply",
    "color.highlight.apply",
    "size.set",
  ] as const;

  function largeEditor(first: object[]) {
    return createTestEditor({
      extensions: WITH_MARKS,
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "paragraph", content: first },
          ...Array.from({ length: PARAGRAPHS }, (_, i) => ({
            type: "paragraph",
            content: [{ type: "text", text: `p${i}` }],
          })),
        ],
      },
    });
  }

  /** Every field the store computes for the colour and size views. */
  function readViews(target: Editor) {
    const ctx = computeContext(target);
    for (const id of SELECTION_VIEWS) {
      const action = getAction(id);
      action.isActive?.(ctx);
      action.isMixed?.(ctx);
      action.value?.(ctx);
    }
  }

  /** Counts `nodesBetween` callbacks on the current doc while reading. */
  function countCallbacks(target: Editor): number {
    const doc = target.state.doc;
    const original = doc.nodesBetween.bind(doc);
    let calls = 0;
    doc.nodesBetween = (from, to, f, start) =>
      original(
        from,
        to,
        (...args) => {
          calls += 1;
          return f(...args);
        },
        start,
      );
    try {
      readViews(target);
    } finally {
      delete (doc as { nodesBetween?: unknown }).nodesBetween;
    }
    return calls;
  }

  it("walks a plain select-all once for all three mark types", () => {
    const big = largeEditor([{ type: "text", text: "plain" }]);
    big.commands.setTextSelection({ from: 1, to: big.state.doc.content.size });
    // One full walk: every block plus its text node.
    const oneWalk = 2 * (PARAGRAPHS + 2);
    expect(countCallbacks(big)).toBeLessThanOrEqual(oneWalk + 10);
    big.destroy();
  });

  it("stops descending once every type is mixed near the start", () => {
    const big = largeEditor([
      {
        type: "text",
        text: "a",
        marks: [
          { type: "textColor", attrs: { color: "red" } },
          { type: "highlight", attrs: { color: "yellow" } },
          { type: "fontSize", attrs: { size: "lg" } },
        ],
      },
      { type: "text", text: "b" },
    ]);
    big.commands.setTextSelection({ from: 1, to: big.state.doc.content.size });
    // Top-level blocks are still visited, but none is descended into.
    expect(countCallbacks(big)).toBeLessThanOrEqual(PARAGRAPHS + 20);
    const ctx = computeContext(big);
    expect(getAction("color.text.apply").isMixed?.(ctx)).toBe(true);
    expect(getAction("color.highlight.apply").isMixed?.(ctx)).toBe(true);
    expect(getAction("size.set").isMixed?.(ctx)).toBe(true);
    big.destroy();
  });

  it("ignores text whose parent cannot hold the mark (code blocks)", () => {
    const mixedWithCode = createTestEditor({
      extensions: WITH_MARKS,
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
              {
                type: "text",
                text: "red",
                marks: [{ type: "textColor", attrs: { color: "red" } }],
              },
            ],
          },
          { type: "codeBlock", content: [{ type: "text", text: "code" }] },
        ],
      },
    });
    mixedWithCode.commands.setTextSelection({
      from: 8,
      to: mixedWithCode.state.doc.content.size - 1,
    });
    const ctx = computeContext(mixedWithCode);
    expect(getAction("color.text.apply").isMixed?.(ctx)).toBe(false);
    expect(getAction("color.text.apply").value?.(ctx)).toBe("Red");
    mixedWithCode.destroy();
  });
});
