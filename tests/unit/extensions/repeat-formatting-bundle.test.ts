import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";
import { TextSelection } from "@tiptap/pm/state";

import {
  bundleFace,
  bundleFromKey,
  bundleKey,
  bundleLabel,
  isEmptyBundle,
  readBundleAt,
  setEntries,
  validateBundle,
} from "@/extensions/repeat-formatting/bundle";

import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function setup(content: unknown): Editor {
  editor = createTestEditor({
    content: content as JSONContent,
    extensions: DEFAULT_EXTENSIONS,
  });
  return editor;
}

const doc = (...paragraphs: unknown[]) => ({
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    },
    ...paragraphs,
  ],
});

describe("validateBundle", () => {
  it("keeps valid fields", () => {
    expect(
      validateBundle({ bold: true, textColor: "red", fontSize: null }),
    ).toEqual({
      bold: true,
      textColor: "red",
      fontSize: null,
    });
  });

  it("drops hostile input", () => {
    expect(validateBundle({ textColor: "red;background:url(x)" })).toBeNull();
    expect(validateBundle({ bold: "yes", italic: true, evil: 1 })).toEqual({
      italic: true,
    });
    expect(validateBundle({ fontSize: "md" })).toBeNull();
    expect(validateBundle({ highlight: "var(--x)" })).toBeNull();
    expect(validateBundle("x")).toBeNull();
    expect(validateBundle(null)).toBeNull();
    expect(validateBundle([])).toBeNull();
    expect(validateBundle({ __proto__: { bold: true } })).toBeNull();
  });
});

describe("bundle keys and labels", () => {
  it("bundleKey is order-stable and round-trips", () => {
    const a = bundleKey({ textColor: "red", bold: true });
    expect(a).toBe(bundleKey({ bold: true, textColor: "red" }));
    expect(bundleFromKey(a)).toEqual({ bold: true, textColor: "red" });
    expect(
      bundleFromKey(bundleKey({ italic: false, highlight: null })),
    ).toEqual({
      italic: false,
      highlight: null,
    });
    expect(bundleFromKey("textColor:red;x")).toBeNull();
    expect(bundleFromKey("")).toBeNull();
  });

  it("bundleFace lists set entries", () => {
    expect(bundleFace({ bold: true, textColor: "red", fontSize: "lg" })).toBe(
      "B · Red · L",
    );
    expect(bundleFace({ highlight: "yellow" })).toBe("Yellow highlight");
    expect(bundleFace({ bold: false })).toBe("Plain");
  });

  it("bundleLabel names sets and clears", () => {
    expect(
      bundleLabel({ bold: true, highlight: "yellow", fontSize: null }),
    ).toBe("Bold, Yellow highlight, default size");
    expect(bundleLabel({ italic: false, textColor: null })).toBe(
      "no italic, no text colour",
    );
  });

  it("setEntries keeps only set fields", () => {
    expect(
      setEntries({
        bold: true,
        italic: false,
        textColor: null,
        highlight: "red",
      }),
    ).toEqual({
      bold: true,
      highlight: "red",
    });
    expect(isEmptyBundle({})).toBe(true);
    expect(isEmptyBundle({ bold: false })).toBe(false);
  });
});

describe("readBundleAt", () => {
  it("reads bold red text", () => {
    const ed = setup(
      doc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "hello",
            marks: [
              { type: "bold" },
              { type: "textColor", attrs: { color: "red" } },
            ],
          },
        ],
      }),
    );
    ed.commands.setTextSelection({ from: 8, to: 13 });
    expect(readBundleAt(ed.state)).toEqual({
      bold: true,
      italic: false,
      underline: false,
      strike: false,
      textColor: "red",
      highlight: null,
      fontSize: null,
    });
  });

  it("maps a legacy highlight value to its token", () => {
    const ed = setup(
      doc({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "hello",
            marks: [
              {
                type: "highlight",
                attrs: { color: "var(--tt-color-highlight-yellow)" },
              },
            ],
          },
        ],
      }),
    );
    ed.commands.setTextSelection({ from: 8, to: 13 });
    expect(readBundleAt(ed.state).highlight).toBe("yellow");
  });

  it("reads stored marks at a caret", () => {
    const ed = setup(
      doc({ type: "paragraph", content: [{ type: "text", text: "hello" }] }),
    );
    const tr = ed.state.tr.setSelection(TextSelection.create(ed.state.doc, 9));
    tr.setStoredMarks([ed.schema.marks.italic.create()]);
    ed.view.dispatch(tr);
    expect(readBundleAt(ed.state).italic).toBe(true);
  });
});
