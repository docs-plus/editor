import { describe, expect, it } from "bun:test";

import { getSchema, type JSONContent } from "@tiptap/core";
import { Node as PMNode } from "@tiptap/pm/model";
import { StarterKit } from "@tiptap/starter-kit";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import {
  EDITOR_FRAGMENT_NAME,
  MARK_MIGRATION_ORIGIN,
  migrateLegacyMarks,
} from "@/lib/yjs-mark-migration";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

/** Schema the editor used before the @docs.plus swap (StarterKit link + code). */
const legacySchema = getSchema([StarterKit]);

const LEGACY_DOC: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Read " },
        {
          type: "text",
          text: "the docs",
          marks: [
            {
              type: "link",
              attrs: { href: "https://docs.plus", target: "_blank" },
            },
          ],
        },
        { type: "text", text: " then call " },
        { type: "text", text: "render()", marks: [{ type: "code" }] },
        { type: "text", text: " now.", marks: [{ type: "bold" }] },
      ],
    },
    {
      type: "bulletList",
      content: [
        {
          type: "listItem",
          content: [
            {
              type: "paragraph",
              content: [
                { type: "text", text: "nested " },
                { type: "text", text: "x", marks: [{ type: "code" }] },
              ],
            },
          ],
        },
      ],
    },
  ],
};

function createLegacyDoc(): Y.Doc {
  return prosemirrorJSONToYDoc(legacySchema, LEGACY_DOC, EDITOR_FRAGMENT_NAME);
}

function collectMarks(json: JSONContent, out: JSONContent[] = []) {
  for (const mark of json.marks ?? []) out.push(mark);
  for (const child of json.content ?? []) collectMarks(child, out);
  return out;
}

function toNewSchemaNode(doc: Y.Doc): PMNode {
  const { schema } = createTestEditor();
  return PMNode.fromJSON(
    schema,
    yDocToProsemirrorJSON(doc, EDITOR_FRAGMENT_NAME),
  );
}

describe("migrateLegacyMarks", () => {
  it("legacy marks are rejected by the current schema before migration", () => {
    expect(() => toNewSchemaNode(createLegacyDoc())).toThrow(
      /no mark type (link|code)/,
    );
  });

  it("renames link → hyperlink and code → inlineCode, keeping text and attrs", () => {
    const doc = createLegacyDoc();

    expect(migrateLegacyMarks(doc)).toBe(3);

    const node = toNewSchemaNode(doc);
    expect(node.textContent).toBe(
      "Read the docs then call render() now.nested x",
    );

    const marks = collectMarks(node.toJSON() as JSONContent);
    const names = marks.map((mark) => mark.type);
    expect(names).not.toContain("link");
    expect(names).not.toContain("code");
    expect(names.filter((name) => name === "inlineCode")).toHaveLength(2);
    expect(names).toContain("bold");

    const hyperlink = marks.find((mark) => mark.type === "hyperlink");
    expect(hyperlink?.attrs?.href).toBe("https://docs.plus");
  });

  it("is idempotent and emits no update once migrated", () => {
    const doc = createLegacyDoc();
    migrateLegacyMarks(doc);

    let updates = 0;
    doc.on("update", () => {
      updates++;
    });

    expect(migrateLegacyMarks(doc)).toBe(0);
    expect(updates).toBe(0);
  });

  it("tags the rewrite with a dedicated transaction origin", () => {
    const doc = createLegacyDoc();
    const origins: unknown[] = [];
    doc.on("update", (_update: Uint8Array, origin: unknown) => {
      origins.push(origin);
    });

    migrateLegacyMarks(doc);

    expect(origins).toEqual([MARK_MIGRATION_ORIGIN]);
  });

  it("converges when two replicas migrate the same doc concurrently", () => {
    const a = createLegacyDoc();
    const b = new Y.Doc();
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    migrateLegacyMarks(a);
    migrateLegacyMarks(b);
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    expect(yDocToProsemirrorJSON(a, EDITOR_FRAGMENT_NAME)).toEqual(
      yDocToProsemirrorJSON(b, EDITOR_FRAGMENT_NAME),
    );
    expect(() => toNewSchemaNode(a)).not.toThrow();
  });

  it("handles hashed (overlapping) mark keys", () => {
    const doc = new Y.Doc();
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    doc.getXmlFragment(EDITOR_FRAGMENT_NAME).insert(0, [paragraph]);
    paragraph.insert(0, [text]);
    text.insert(0, "hashed", { "link--AbCd12+/": { href: "https://a.b" } });

    expect(migrateLegacyMarks(doc)).toBe(1);
    expect(text.toDelta()).toEqual([
      {
        insert: "hashed",
        attributes: { "hyperlink--AbCd12+/": { href: "https://a.b" } },
      },
    ]);
  });

  describe("legacy highlight colours (rewriteHighlights)", () => {
    const ON = { rewriteHighlights: true };
    /** One paragraph whose text runs carry the given attributes. */
    const runs = (...parts: [string, Record<string, unknown>][]) => {
      const doc = new Y.Doc();
      const paragraph = new Y.XmlElement("paragraph");
      const text = new Y.XmlText();
      doc.getXmlFragment(EDITOR_FRAGMENT_NAME).insert(0, [paragraph]);
      paragraph.insert(0, [text]);
      let at = 0;
      for (const [insert, attributes] of parts) {
        text.insert(at, insert, attributes);
        at += insert.length;
      }
      return { doc, text };
    };

    it("is off by default: legacy values stay as stored", () => {
      const { doc, text } = runs([
        "a",
        { highlight: { color: "var(--tt-color-highlight-yellow)" } },
      ]);
      expect(migrateLegacyMarks(doc)).toBe(0);
      expect(text.toDelta()).toEqual([
        {
          insert: "a",
          attributes: {
            highlight: { color: "var(--tt-color-highlight-yellow)" },
          },
        },
      ]);
    });

    it("rewrites var(--tt-color-highlight-X) to the token X", () => {
      const { doc, text } = runs(
        ["a", { highlight: { color: "var(--tt-color-highlight-yellow)" } }],
        ["b", { highlight: { color: "var(--tt-color-highlight-red)" } }],
      );
      expect(migrateLegacyMarks(doc, ON)).toBe(2);
      expect(text.toDelta()).toEqual([
        { insert: "a", attributes: { highlight: { color: "yellow" } } },
        { insert: "b", attributes: { highlight: { color: "red" } } },
      ]);
      expect(migrateLegacyMarks(doc, ON)).toBe(0);
    });

    it("leaves tokens, unknown and hostile values untouched", () => {
      const values = ["teal", "#ff0", "var(--background)", "red;x", null];
      const { doc, text } = runs(
        ...values.map((color, i): [string, Record<string, unknown>] => [
          String(i),
          { highlight: { color } },
        ]),
      );
      const before = text.toDelta();
      const updates: Uint8Array[] = [];
      doc.on("update", (u: Uint8Array) => updates.push(u));
      expect(migrateLegacyMarks(doc, ON)).toBe(0);
      expect(text.toDelta()).toEqual(before);
      expect(updates).toHaveLength(0);
    });

    it("rewrites a run that also carries a legacy link, in one patch", () => {
      const { doc, text } = runs([
        "both",
        {
          link: { href: "https://a.b" },
          highlight: { color: "var(--tt-color-highlight-blue)" },
        },
      ]);
      expect(migrateLegacyMarks(doc, ON)).toBe(1);
      expect(text.toDelta()).toEqual([
        {
          insert: "both",
          attributes: {
            hyperlink: { href: "https://a.b" },
            highlight: { color: "blue" },
          },
        },
      ]);
    });

    it("the rewritten doc loads in the editor with the token", () => {
      const { doc } = runs([
        "x",
        { highlight: { color: "var(--tt-color-highlight-green)" } },
      ]);
      migrateLegacyMarks(doc, ON);
      expect(
        collectMarks(yDocToProsemirrorJSON(doc, EDITOR_FRAGMENT_NAME)),
      ).toEqual([{ type: "highlight", attrs: { color: "green" } }]);
    });
  });

  it("does not create the editor fragment on docs without one", () => {
    const doc = new Y.Doc();
    doc.getArray("tabs").push(["playground"]);

    expect(migrateLegacyMarks(doc)).toBe(0);
    expect(doc.share.has(EDITOR_FRAGMENT_NAME)).toBe(false);
  });
});
