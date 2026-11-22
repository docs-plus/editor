import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";

import { type FindHit, scanHits } from "@/extensions/find/find-hits";
import {
  FIND_CURRENT_HIGHLIGHT,
  FIND_HIGHLIGHT,
  type HighlightApi,
  HighlightPainter,
  nativeHighlightApi,
  supportsHighlights,
} from "@/extensions/find/find-painter";
import { buildFindPattern } from "@/extensions/find/find-pattern";

import { createTestEditor } from "../../../helpers/create-test-editor";

/** The CSS Custom Highlight API, which happy-dom lacks: a Set of ranges. */
class FakeHighlight extends Set<AbstractRange> {
  priority = 0;
}

const registry = new Map<string, FakeHighlight>();
const api: HighlightApi = {
  registry: registry as unknown as HighlightApi["registry"],
  create: () => new FakeHighlight() as unknown as Highlight,
};

let editor: Editor | undefined;
let painter: HighlightPainter | undefined;
afterEach(() => {
  painter?.destroy();
  editor?.destroy();
  painter = undefined;
  editor = undefined;
  registry.clear();
});

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function setup(content: JSONContent[], query: string) {
  editor = createTestEditor({ content: { type: "doc", content } });
  document.body.append(editor.view.dom);
  painter = new HighlightPainter(editor.view, api);
  const pattern = buildFindPattern(query, {
    caseSensitive: false,
    wholeWord: false,
  }) as RegExp;
  return { e: editor, p: painter, hits: scanHits(editor.state.doc, pattern) };
}

const painted = (name: string) =>
  [...(registry.get(name) ?? [])].map((range) => (range as Range).toString());

describe("HighlightPainter", () => {
  it("paints nothing where the Highlight API is missing (happy-dom)", () => {
    expect(supportsHighlights()).toBe(false);
    expect(nativeHighlightApi()).toBeNull();
    editor = createTestEditor();
    const quiet = new HighlightPainter(editor.view);
    quiet.paint([{ from: 1, to: 1 }], [], null);
    quiet.destroy();
  });

  it("paints every hit and the current one, without touching the editor DOM", async () => {
    const { e, p, hits } = setup(
      [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Fox" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "a f" },
            { type: "text", text: "ox", marks: [{ type: "bold" }] },
          ],
        },
      ],
      "fox",
    );
    const html = e.view.dom.innerHTML;
    p.paint(hits, [], hits[1]);
    expect(painted(FIND_CURRENT_HIGHLIGHT)).toEqual(["fox"]);
    await frame();
    expect(painted(FIND_HIGHLIGHT).sort()).toEqual(["Fox", "fox"]);
    expect(registry.get(FIND_CURRENT_HIGHLIGHT)?.priority).toBe(1);
    expect(e.view.dom.innerHTML).toBe(html);
  });

  it("releases dropped hits and rebuilds ranges in a redrawn block", async () => {
    const { e, p, hits } = setup(
      [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          content: [{ type: "text", text: "one cat, two cat" }],
        },
      ],
      "cat",
    );
    p.paint(hits, [], hits[0]);
    await frame();
    // Bold over "one" redraws the paragraph's DOM; the text nodes holding
    // the old ranges are replaced.
    e.commands.setTextSelection({ from: 8, to: 11 });
    e.commands.toggleBold();
    await frame();
    await frame();
    expect(painted(FIND_HIGHLIGHT)).toEqual(["cat", "cat"]);
    p.paint([hits[1]], [hits[0]], hits[1]);
    expect(painted(FIND_HIGHLIGHT)).toEqual(["cat"]);
    expect(painted(FIND_CURRENT_HIGHLIGHT)).toEqual(["cat"]);
  });

  it("unregisters its highlights when destroyed", () => {
    const { p, hits } = setup(
      [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "x" }],
        },
      ],
      "x",
    );
    p.paint(hits, [], hits[0] as FindHit);
    p.destroy();
    painter = undefined;
    expect(registry.size).toBe(0);
  });
});
