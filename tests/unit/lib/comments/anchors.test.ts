/**
 * The anchor spike of comments design §3, as fixed cases: what Yjs alone
 * gives, and what the editing client's re-anchor makes of it. The doc is
 * Title / "alpha beta gamma" / "delta omega"; the thread is on "beta".
 */
import { describe, expect, it } from "bun:test";

import { findWrapping } from "@tiptap/pm/transform";
import * as Y from "yjs";

import { isSafeAnchor } from "@/lib/comments/entry-check";
import { CLIENT_LIMITS } from "@/lib/comments/limits";
import { type Anchors, anchorKey } from "@/lib/comments/model";
import { SECTION_MOVE_META } from "@/lib/comments/reanchor";

import { joinBackward, splitAt } from "../../../helpers/comment-fuzz-ops";
import {
  createHarnessClient,
  type HarnessClient,
} from "../../../helpers/comment-harness";

// Title is 0..7; the paragraph opens at 7, its text starts at 8.
const BETA = { from: 14, to: 18 };

function setup(): { client: HarnessClient; tid: string } {
  const client = createHarnessClient({
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
          content: [{ type: "text", text: "alpha beta gamma" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "delta omega" }] },
      ],
    },
  });
  expect(client.state.doc.textBetween(BETA.from, BETA.to)).toBe("beta");
  const tid = client.createThread(BETA);
  if (!tid) throw new Error("no thread");
  return { client, tid };
}

const textOf = (client: HarnessClient, tid: string) => {
  const range = client.resolve(tid);
  return range ? client.state.doc.textBetween(range.from, range.to, "|") : null;
};

const undoAll = (client: HarnessClient) => {
  while (client.undo.canUndo()) client.undo.undo();
  client.reload();
};

describe("anchors follow edits (§3)", () => {
  it("are item- or type-based, never name-based, and at most 64 bytes", () => {
    const { client, tid } = setup();
    const anchors = client.store.map.get(anchorKey(tid)) as Anchors;
    for (const bytes of [anchors.s, anchors.e]) {
      expect(isSafeAnchor(bytes, CLIENT_LIMITS)).toBe(true);
      expect(Y.decodeRelativePosition(bytes).tname).toBeNull();
    }
  });

  it("include typing inside the range", () => {
    const { client, tid } = setup();
    client.apply(client.state.tr.insertText("X", BETA.from + 2));
    expect(textOf(client, tid)).toBe("beXta");
  });

  it("leave out typing just before the start and just after the end", () => {
    const { client, tid } = setup();
    client.apply(client.state.tr.insertText("<", BETA.from));
    client.apply(client.state.tr.insertText(">", BETA.to + 1));
    expect(textOf(client, tid)).toBe("beta");
  });

  it("include a collaborator's insert inside the range", () => {
    const { client, tid } = setup();
    // Synced before the harness starts, so it doesn't seed its own copy.
    const doc = new Y.Doc();
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(client.doc));
    const other = createHarnessClient({ doc });
    other.apply(other.state.tr.insertText("ZZ", BETA.from + 2));
    Y.applyUpdate(client.doc, Y.encodeStateAsUpdate(other.doc));
    client.reload();
    expect(textOf(client, tid)).toBe("beZZta");
  });

  it("survive bold on the anchored text", () => {
    const { client, tid } = setup();
    client.apply(
      client.state.tr.addMark(
        BETA.from,
        BETA.to,
        client.state.schema.marks.bold.create(),
      ),
    );
    expect(textOf(client, tid)).toBe("beta");
  });
});

describe("the editing client re-anchors structural edits (§3, §5.3)", () => {
  const cases: [string, (client: HarnessClient) => void, string][] = [
    [
      "paragraph to heading",
      (client) =>
        client.apply(
          client.state.tr.setBlockType(
            BETA.from,
            BETA.from,
            client.state.schema.nodes.heading,
            {
              level: 2,
            },
          ),
        ),
      "beta",
    ],
    [
      "wrap in a blockquote",
      (client) => {
        const range = client.state.doc.resolve(BETA.from).blockRange();
        const wrapping =
          range && findWrapping(range, client.state.schema.nodes.blockquote);
        if (!range || !wrapping) throw new Error("no wrap");
        client.apply(client.state.tr.wrap(range, wrapping));
      },
      "beta",
    ],
    [
      "wrap in a list",
      (client) => {
        const range = client.state.doc.resolve(BETA.from).blockRange();
        const wrapping =
          range && findWrapping(range, client.state.schema.nodes.bulletList);
        if (!range || !wrapping) throw new Error("no wrap");
        client.apply(client.state.tr.wrap(range, wrapping));
      },
      "beta",
    ],
    [
      "Enter before the range, in the same paragraph",
      (client) => {
        const tr = splitAt(client.state, 10);
        if (!tr) throw new Error("no split");
        client.apply(tr);
      },
      "beta",
    ],
    [
      "join with the previous paragraph",
      (client) => {
        // Make "beta …" its own paragraph, then Backspace at its start.
        const split = splitAt(client.state, BETA.from);
        if (!split) throw new Error("no split");
        client.apply(split);
        const join = joinBackward(client.state, BETA.from + 2);
        if (!join) throw new Error("no join");
        client.apply(join);
      },
      "beta",
    ],
    [
      "Enter inside the range (it spans both blocks)",
      (client) => {
        const tr = splitAt(client.state, BETA.from + 2);
        if (!tr) throw new Error("no split");
        client.apply(tr);
      },
      "be|ta",
    ],
    [
      "a section move",
      (client) => {
        const { doc } = client.state;
        const first = doc.child(1);
        const from = doc.child(0).nodeSize;
        const to = from + first.nodeSize;
        const tr = client.state.tr;
        const content = doc.slice(from, to).content;
        tr.delete(from, to);
        const insertAt = tr.mapping.map(doc.content.size);
        tr.insert(insertAt, content);
        tr.setMeta(SECTION_MOVE_META, { from, to, insertAt });
        client.apply(tr);
      },
      "beta",
    ],
  ];

  for (const [name, edit, expected] of cases) {
    it(`${name}: resolves, and undo brings back the original`, () => {
      const { client, tid } = setup();
      edit(client);
      expect(textOf(client, tid)).toBe(expected);
      undoAll(client);
      expect(textOf(client, tid)).toBe("beta");
    });
  }
});

describe("deleted text (§3, §5.3)", () => {
  it("is Detached while deleted and comes back with undo", () => {
    const { client, tid } = setup();
    client.apply(client.state.tr.delete(BETA.from, BETA.to));
    expect(client.resolve(tid)).toBeNull();
    undoAll(client);
    expect(textOf(client, tid)).toBe("beta");
  });

  it("survives deleting the whole paragraph, then undo", () => {
    const { client, tid } = setup();
    const $pos = client.state.doc.resolve(BETA.from);
    client.apply(client.state.tr.delete($pos.before(), $pos.after()));
    expect(client.resolve(tid)).toBeNull();
    undoAll(client);
    expect(textOf(client, tid)).toBe("beta");
  });
});
