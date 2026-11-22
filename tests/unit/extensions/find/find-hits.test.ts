import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, JSONContent } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import {
  blockText,
  changedRanges,
  type FindHit,
  MAX_PAINTED_PER_BLOCK,
  paintableHits,
  scanHits,
  updateHits,
} from "@/extensions/find/find-hits";
import { buildFindPattern } from "@/extensions/find/find-pattern";

import { createTestEditor } from "../../../helpers/create-test-editor";
import { generateLargeDocument } from "../../../helpers/document-generators";

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const pattern = (query: string) =>
  buildFindPattern(query, { caseSensitive: false, wholeWord: false }) as RegExp;

const heading = (text: string): JSONContent => ({
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text }],
});
const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  content,
});
const text = (value: string, marks?: JSONContent["marks"]): JSONContent => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});

function create(content: JSONContent[]): Editor {
  editor = createTestEditor({ content: { type: "doc", content } });
  return editor;
}

/** The document text under each hit. */
const texts = (e: Editor, hits: FindHit[]) =>
  hits.map((hit) => e.state.doc.textBetween(hit.from, hit.to));

const plain = (hits: FindHit[]) => hits.map(({ from, to }) => ({ from, to }));

describe("scanHits", () => {
  it("finds every match in headings, paragraphs, lists and tables", () => {
    const e = create([
      heading("Plan the plan"),
      paragraph(text("A "), text("plan", [{ type: "bold" }]), text("ned day")),
      {
        type: "bulletList",
        content: [{ type: "listItem", content: [paragraph(text("plan B"))] }],
      },
    ]);
    const hits = scanHits(e.state.doc, pattern("plan"));
    expect(texts(e, hits)).toEqual(["Plan", "plan", "plan", "plan"]);
  });

  it("matches across marks but never across a hard break", () => {
    const e = create([
      heading("Title"),
      paragraph(
        text("fo"),
        text("o", [{ type: "italic" }]),
        { type: "hardBreak" },
        text("bar"),
      ),
    ]);
    expect(texts(e, scanHits(e.state.doc, pattern("foo")))).toEqual(["foo"]);
    expect(scanHits(e.state.doc, pattern("obar"))).toEqual([]);
    expect(blockText(e.state.doc.child(1))).toBe("foo￼bar");
  });

  it("stops at the limit", () => {
    const e = create([heading("a a a a a")]);
    expect(
      scanHits(e.state.doc, pattern("a"), 0, e.state.doc.content.size, [], 3),
    ).toHaveLength(3);
  });

  it("scans 1,000 headings fast", () => {
    const e = createTestEditor({
      content: generateLargeDocument(1000, "flat"),
    });
    editor = e;
    const started = performance.now();
    const hits = scanHits(e.state.doc, pattern("e"));
    const first = performance.now() - started;
    const again = performance.now();
    scanHits(e.state.doc, pattern("the"));
    const cached = performance.now() - again;
    expect(hits.length).toBeGreaterThan(1000);
    // Generous for loaded CI machines; the cached pass reuses block texts.
    expect(first).toBeLessThan(500);
    expect(cached).toBeLessThan(250);
  }, 20_000);
});

describe("changedRanges", () => {
  it("maps every step's range to the final document", () => {
    const e = create([
      heading("Title"),
      paragraph(text("abc")),
      paragraph(text("def")),
    ]);
    const tr = e.state.tr.insertText("XX", 8).insertText("Y", 2);
    // "Y" at 2 shifts the "XX" insert (8–10) to 9–11.
    expect(changedRanges(tr)).toEqual([
      [2, 3],
      [9, 11],
    ]);
  });
});

describe("updateHits", () => {
  /** Applies `tr` and checks the update against a full scan. */
  function check(e: Editor, hits: FindHit[], tr: Transaction, regex: RegExp) {
    const update = updateHits(hits, tr, regex);
    e.view.dispatch(tr);
    expect(plain(update.hits)).toEqual(plain(scanHits(e.state.doc, regex)));
    return update;
  }

  it("maps hits outside the edit in place and rescans only the edited block", () => {
    const e = create([
      heading("cat"),
      paragraph(text("cat one")),
      paragraph(text("two cat")),
    ]);
    const regex = pattern("cat");
    const hits = scanHits(e.state.doc, regex);
    const [title, , last] = hits;
    const update = check(e, hits, e.state.tr.insertText("dog ", 15), regex);
    // "dog two cat": every hit, the edited block's too, is the same object.
    expect(update.hits[0]).toBe(title);
    expect(update.hits[2]).toBe(last);
    expect(update.dropped).toHaveLength(0);
    expect(texts(e, update.hits)).toEqual(["cat", "cat", "cat"]);
  });

  it("keeps the unchanged hits of the edited block, so their ranges live on", () => {
    const e = create([heading("Title"), paragraph(text("pin ".repeat(5_000)))]);
    const regex = pattern("pin");
    const hits = scanHits(e.state.doc, regex);
    expect(hits).toHaveLength(5_000);
    const [first, second] = hits;
    const middle = hits[2_500];
    // Type into the first hit: only it changes.
    const update = check(
      e,
      hits,
      e.state.tr.insertText("x", first.from + 1),
      regex,
    );
    expect(update.dropped).toEqual([first]);
    expect(update.hits).toHaveLength(4_999);
    expect(update.hits[0]).toBe(second);
    expect(update.hits[2_499]).toBe(middle);
    // Typing between hits drops none.
    const next = check(
      e,
      update.hits,
      e.state.tr.insertText(" ", second.to),
      regex,
    );
    expect(next.dropped).toHaveLength(0);
    expect(next.hits[0]).toBe(second);
  });

  it("drops a hit whose text is edited and finds one an edit creates", () => {
    const e = create([heading("Title"), paragraph(text("ca t and cat"))]);
    const regex = pattern("cat");
    let hits = scanHits(e.state.doc, regex);
    expect(hits).toHaveLength(1);
    hits = check(e, hits, e.state.tr.delete(10, 11), regex).hits;
    expect(texts(e, hits)).toEqual(["cat", "cat"]);
    hits = check(e, hits, e.state.tr.insertText("X", 18), regex).hits;
    expect(texts(e, hits)).toEqual(["cat"]);
  });

  it("handles a split and a join (Enter and Backspace)", () => {
    const e = create([heading("Title"), paragraph(text("needle needle"))]);
    const regex = pattern("needle");
    let hits = scanHits(e.state.doc, regex);
    hits = check(e, hits, e.state.tr.split(15), regex).hits;
    expect(texts(e, hits)).toEqual(["needle", "needle"]);
    hits = check(e, hits, e.state.tr.join(16), regex).hits;
    expect(texts(e, hits)).toEqual(["needle", "needle"]);
  });

  it("handles a collaborator's update that replaces whole top-level blocks", () => {
    const e = create([
      heading("Title"),
      paragraph(text("alpha")),
      paragraph(text("beta alpha")),
      paragraph(text("alpha")),
    ]);
    const regex = pattern("alpha");
    const hits = scanHits(e.state.doc, regex);
    const first = hits[0];
    const block = e.state.doc.child(2);
    const start = e.state.doc.child(0).nodeSize + e.state.doc.child(1).nodeSize;
    const replacement = e.schema.nodes.paragraph.create(
      null,
      e.schema.text("alpha beta alpha gamma"),
    );
    const update = check(
      e,
      hits,
      e.state.tr.replaceWith(start, start + block.nodeSize, replacement),
      regex,
    );
    expect(update.hits[0]).toBe(first);
    expect(texts(e, update.hits)).toEqual(["alpha", "alpha", "alpha", "alpha"]);
  });

  it("agrees with a full scan over random edits", () => {
    const e = create([
      heading("an anagram"),
      paragraph(text("banana and ananas")),
      paragraph(text("nan")),
    ]);
    const regex = pattern("ana");
    let hits = scanHits(e.state.doc, regex);
    let seed = 7;
    const random = (n: number) => {
      seed = (seed * 16807) % 2147483647;
      return seed % n;
    };
    const pieces = ["a", "n", "an", "na", " ", "ana"];
    for (let round = 0; round < 300; round++) {
      const { doc } = e.state;
      const positions: number[] = [];
      doc.descendants((node, pos) => {
        if (node.isText) {
          for (let i = 0; i <= node.nodeSize; i++) positions.push(pos + i);
        }
      });
      const at = positions[random(positions.length)];
      const tr = e.state.tr;
      const kind = random(4);
      if (kind === 0 && doc.resolve(at).parent.isTextblock) {
        const end = Math.min(at + 1 + random(3), doc.resolve(at).end());
        tr.delete(at, end);
      } else if (
        kind === 1 &&
        doc.resolve(at).parent.type.name === "paragraph"
      ) {
        tr.split(at);
      } else {
        tr.insertText(pieces[random(pieces.length)], at);
      }
      if (!tr.docChanged) continue;
      hits = check(e, hits, tr, regex).hits;
    }
  });

  it("leaves hits alone without a document change", () => {
    const e = create([heading("x x")]);
    const regex = pattern("x");
    const hits = scanHits(e.state.doc, regex);
    expect(updateHits(hits, e.state.tr.setMeta("m", 1), regex).hits).toBe(hits);
  });
});

describe("paintableHits", () => {
  it("is every hit while no block holds more than the per-block limit", () => {
    const e = create([
      heading("Title"),
      paragraph(text("pin ".repeat(MAX_PAINTED_PER_BLOCK))),
      paragraph(text("pin ".repeat(MAX_PAINTED_PER_BLOCK))),
    ]);
    const hits = scanHits(e.state.doc, pattern("pin"));
    expect(paintableHits(e.state.doc, hits, hits[0])).toBe(hits);
  });

  it("paints a crowded block's hits around the current one, and the rest in full", () => {
    const e = create([
      heading("pin"),
      paragraph(text("pin ".repeat(2_000))),
      paragraph(text("pin pin")),
    ]);
    const hits = scanHits(e.state.doc, pattern("pin"));
    expect(hits).toHaveLength(2_003);
    const first = paintableHits(e.state.doc, hits, hits[0]);
    // The title's hit, the crowded block's first ones, the last block's two.
    expect(first).toHaveLength(1 + MAX_PAINTED_PER_BLOCK + 2);
    expect(first.slice(0, 3)).toEqual(hits.slice(0, 3));
    expect(first.slice(-2)).toEqual(hits.slice(-2));
    const current = hits[1_000];
    const around = paintableHits(e.state.doc, hits, current);
    expect(around).toHaveLength(1 + MAX_PAINTED_PER_BLOCK + 2);
    expect(around).toContain(current);
    expect(around[1]).toBe(hits[1_000 - Math.floor(MAX_PAINTED_PER_BLOCK / 2)]);
    // Near the block's end the window stops at its last hit.
    const late = paintableHits(e.state.doc, hits, hits[2_000]);
    expect(late[MAX_PAINTED_PER_BLOCK]).toBe(hits[2_000]);
  });
});
