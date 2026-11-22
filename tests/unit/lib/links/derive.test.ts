import { describe, expect, it } from "bun:test";

import { getSchema, type JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import {
  DERIVE_VERSION,
  deriveDocument,
  extractHeadings,
  extractLinks,
  toHeadingRows,
  toLinkRows,
} from "@/lib/links/extract-links";
import { DEFAULT_EXTENSIONS } from "@/tests/helpers/create-test-editor";

/**
 * The derive layer's contract with format 2 (offline data-model revision
 * §4: `links` and `doc_headings`): one walk gives both, `toLinkRows` and
 * `toHeadingRows` map to the table columns, and `DERIVE_VERSION` versions
 * the output.
 */
const schema = getSchema(DEFAULT_EXTENSIONS);
const KEY = "0123456789abcdef0123456789abcdef";
const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";
const T3 = "33333333-3333-4333-8333-333333333333";
const SRC = "doc-src";

const text = (value: string, href?: string): JSONContent =>
  href
    ? {
        type: "text",
        text: value,
        marks: [{ type: "hyperlink", attrs: { href } }],
      }
    : { type: "text", text: value };
const heading = (
  tocId: string | null,
  level: number,
  ...content: JSONContent[]
): JSONContent => ({
  type: "heading",
  attrs: tocId ? { level, "data-toc-id": tocId } : { level },
  content,
});
const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  content,
});
const fragmentOf = (...content: JSONContent[]) =>
  prosemirrorJSONToYDoc(
    schema,
    { type: "doc", content },
    "default",
  ).getXmlFragment("default");

describe("DERIVE_VERSION", () => {
  it("starts at 1", () => {
    expect(DERIVE_VERSION).toBe(1);
  });
});

describe("extractHeadings", () => {
  it("lists headings in order with their id, level and text", () => {
    const fragment = fragmentOf(
      heading(T1, 1, text("Q4 plan")),
      paragraph(text("Intro")),
      heading(
        T2,
        2,
        text("Travel "),
        text("and", `tinydocy:doc/${KEY}`),
        text(" hotels"),
      ),
      heading(T3, 3, text("  Spaced   out  ")),
    );
    expect(extractHeadings(fragment)).toEqual([
      { ord: 0, tocId: T1, level: 1, text: "Q4 plan" },
      { ord: 1, tocId: T2, level: 2, text: "Travel and hotels" },
      { ord: 2, tocId: T3, level: 3, text: "Spaced out" },
    ]);
  });

  it("skips headings with no id yet, keeping ord dense", () => {
    const fragment = fragmentOf(
      heading(T1, 1, text("Title")),
      heading(null, 2, text("Unnamed")),
      heading(T2, 2, text("Named")),
    );
    expect(extractHeadings(fragment)).toEqual([
      { ord: 0, tocId: T1, level: 1, text: "Title" },
      { ord: 1, tocId: T2, level: 2, text: "Named" },
    ]);
  });

  it("clamps a stored level to 1–6", () => {
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment("default");
    const odd = new Y.XmlElement("heading");
    odd.setAttribute("data-toc-id", T1);
    odd.setAttribute("level", 9 as unknown as string);
    odd.insert(0, [new Y.XmlText("Deep")]);
    fragment.insert(0, [odd]);
    expect(extractHeadings(fragment)).toEqual([
      { ord: 0, tocId: T1, level: 6, text: "Deep" },
    ]);
  });
});

describe("deriveDocument", () => {
  it("gives links and headings from one walk of a bare Y.Doc", () => {
    // Built by hand, no editor schema: the worker derives this way.
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment("default");
    const title = new Y.XmlElement("heading");
    title.setAttribute("data-toc-id", T1);
    title.setAttribute("level", 1 as unknown as string);
    title.insert(0, [new Y.XmlText("Plan")]);
    const body = new Y.XmlElement("paragraph");
    const run = new Y.XmlText();
    body.insert(0, [run]);
    fragment.insert(0, [title, body]);
    run.insert(0, "See ");
    run.insert(4, "budget", {
      hyperlink: { href: `tinydocy:doc/${KEY}#${T2}` },
    });

    const derived = deriveDocument(fragment);
    expect(derived.headings).toEqual([
      { ord: 0, tocId: T1, level: 1, text: "Plan" },
    ]);
    expect(derived.links).toEqual([
      {
        srcTocId: T1,
        key: KEY,
        tocId: T2,
        text: "budget",
        context: "See budget",
      },
    ]);
    expect(extractLinks(fragment)).toEqual(derived.links);
    expect(extractHeadings(fragment)).toEqual(derived.headings);
  });
});

describe("toLinkRows", () => {
  it("maps to the links columns: the source doc, ord by index, nulls as ''", () => {
    const fragment = fragmentOf(
      paragraph(text("before any heading", `tinydocy:doc/${KEY}`)),
      heading(T1, 1, text("Title")),
      paragraph(text("to a heading", `tinydocy:doc/${KEY}#${T2}`)),
    );
    expect(toLinkRows(SRC, extractLinks(fragment))).toEqual([
      {
        src_doc_id: SRC,
        ord: 0,
        src_toc_id: "",
        target_key: KEY,
        target_toc_id: "",
        text: "before any heading",
        context: "before any heading",
      },
      {
        src_doc_id: SRC,
        ord: 1,
        src_toc_id: T1,
        target_key: KEY,
        target_toc_id: T2,
        text: "to a heading",
        context: "to a heading",
      },
    ]);
  });

  it("maps nothing to nothing", () => {
    expect(toLinkRows(SRC, [])).toEqual([]);
  });
});

describe("toHeadingRows", () => {
  it("maps to the doc_headings columns, less the worker's text_key", () => {
    const fragment = fragmentOf(
      heading(T1, 1, text("Q4 plan")),
      heading(null, 2, text("Unnamed")),
      heading(T2, 3, text("Travel")),
    );
    expect(toHeadingRows(SRC, extractHeadings(fragment))).toEqual([
      { doc_id: SRC, ord: 0, toc_id: T1, level: 1, text: "Q4 plan" },
      { doc_id: SRC, ord: 1, toc_id: T2, level: 3, text: "Travel" },
    ]);
  });

  it("maps nothing to nothing", () => {
    expect(toHeadingRows(SRC, [])).toEqual([]);
  });
});
