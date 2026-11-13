import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, Extension, JSONContent } from "@tiptap/core";

import { scanDocFormats } from "@/lib/doc-format-scan";

import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";
import {
  FontSizeStandIn,
  TextColorStandIn,
} from "../extensions/text-style-stand-ins";

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

function docOf(paragraphs: JSONContent[]): Editor {
  editor = createTestEditor({
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "T" }],
        },
        ...paragraphs,
      ],
    },
    extensions: [
      ...DEFAULT_EXTENSIONS,
      TextColorStandIn,
      FontSizeStandIn,
    ] as Extension[],
  });
  return editor;
}

const text = (value: string, marks: JSONContent["marks"]) => ({
  type: "paragraph",
  content: [{ type: "text", text: value, marks }],
});

describe("scanDocFormats", () => {
  it("collects colours and highlights", () => {
    const ed = docOf([
      text("red", [{ type: "textColor", attrs: { color: "red" } }]),
      text("hl", [{ type: "highlight", attrs: { color: "yellow" } }]),
    ]);
    const scan = scanDocFormats(ed.state.doc);
    expect([...scan.textColors]).toEqual(["red"]);
    expect([...scan.highlights]).toEqual(["yellow"]);
  });

  it("ranks bundles by characters", () => {
    const ed = docOf([
      text("small", [{ type: "fontSize", attrs: { size: "lg" } }]),
      text("x".repeat(30), [
        { type: "bold" },
        { type: "textColor", attrs: { color: "red" } },
      ]),
    ]);
    const scan = scanDocFormats(ed.state.doc);
    expect(scan.bundles).toEqual([
      { bold: true, textColor: "red" },
      { fontSize: "lg" },
    ]);
  });

  it("leaves plain bold out", () => {
    const ed = docOf([text("bold", [{ type: "bold" }])]);
    expect(scanDocFormats(ed.state.doc).bundles).toEqual([]);
  });

  it("caps the walk and the entries, fast, and stores nothing", () => {
    const tokens = ["red", "blue", "green", "teal", "pink", "gray"];
    const sizes = ["xs", "sm", "lg", "xl"];
    const paragraphs = Array.from({ length: 6000 }, (_, i) =>
      text(`t${i}`, [
        { type: "textColor", attrs: { color: tokens[i % tokens.length] } },
        { type: "fontSize", attrs: { size: sizes[i % sizes.length] } },
        ...(i % 2 ? [{ type: "bold" }] : []),
      ]),
    );
    const ed = docOf(paragraphs);
    const before = localStorage.length;
    const start = performance.now();
    const scan = scanDocFormats(ed.state.doc);
    const elapsed = performance.now() - start;
    expect(scan.truncated).toBe(true);
    expect(scan.bundles.length).toBeLessThanOrEqual(8);
    expect(elapsed).toBeLessThan(50);
    expect(localStorage.length).toBe(before);
  });
});
