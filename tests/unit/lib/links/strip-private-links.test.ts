import { describe, expect, it } from "bun:test";

import { getSchema, type JSONContent } from "@tiptap/core";
import {
  prosemirrorJSONToYDoc,
  yXmlFragmentToProsemirrorJSON,
} from "@tiptap/y-tiptap";
import type * as Y from "yjs";

import {
  countPrivateDocLinks,
  stripPrivateDocLinks,
} from "@/lib/links/strip-private-links";
import { DEFAULT_EXTENSIONS } from "@/tests/helpers/create-test-editor";

/**
 * D-O8: when a document is shared, links to documents that aren't shared
 * become plain text by default. Bare Y.Docs, as the share path holds them.
 */
const schema = getSchema(DEFAULT_EXTENSIONS);

const PRIVATE = "0123456789abcdef0123456789abcdef";
const OTHER = "fedcba9876543210fedcba9876543210";
const SHARED = "abcdefabcdefabcdefabcdefabcdefab";
const TOC = "11111111-1111-4111-8111-111111111111";
const TITLE_TOC = "33333333-3333-4333-8333-333333333333";

type Mark = NonNullable<JSONContent["marks"]>[number];

const link = (href: string): Mark => ({ type: "hyperlink", attrs: { href } });
const bold: Mark = { type: "bold" };

function text(value: string, marks: Mark[] = []): JSONContent {
  return marks.length > 0
    ? { type: "text", text: value, marks }
    : { type: "text", text: value };
}

const paragraph = (...content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  content,
});

const title: JSONContent = {
  type: "heading",
  attrs: { level: 1, "data-toc-id": TITLE_TOC },
  content: [text("Title")],
};

function docOf(...content: JSONContent[]) {
  const ydoc = prosemirrorJSONToYDoc(
    schema,
    { type: "doc", content: [title, ...content] },
    "default",
  );
  const fragment = ydoc.getXmlFragment("default");
  let updates = 0;
  ydoc.on("update", () => {
    updates++;
  });
  return {
    fragment,
    updates: () => updates,
    json: () => normalized(fragment),
  };
}

/**
 * The fragment as the editor loads it: ProseMirror joins adjacent text
 * with the same marks, which Yjs may keep as separate items.
 */
const normalized = (fragment: Y.XmlFragment) =>
  schema.nodeFromJSON(yXmlFragmentToProsemirrorJSON(fragment)).toJSON();

/** What the same content reads as after a share, for comparison. */
function jsonOf(...content: JSONContent[]) {
  return normalized(
    prosemirrorJSONToYDoc(
      schema,
      { type: "doc", content: [title, ...content] },
      "default",
    ).getXmlFragment("default"),
  );
}

const doc = (key: string, tocId?: string) =>
  `tinydocy:doc/${key}${tocId ? `#${tocId}` : ""}`;

describe("stripPrivateDocLinks (D-O8)", () => {
  it("turns a link to an unshared document into plain text", () => {
    const d = docOf(
      paragraph(text("See "), text("the plan", [link(doc(PRIVATE))])),
    );
    expect(stripPrivateDocLinks(d.fragment, new Set())).toBe(1);
    expect(d.json()).toEqual(jsonOf(paragraph(text("See the plan"))));
  });

  it("strips heading links too", () => {
    const d = docOf(paragraph(text("x", [link(doc(PRIVATE, TOC))])));
    expect(stripPrivateDocLinks(d.fragment, new Set())).toBe(1);
    expect(d.json()).toEqual(jsonOf(paragraph(text("x"))));
  });

  it("keeps here# links, links to shared documents and web links", () => {
    const content = paragraph(
      text("here", [link(`tinydocy:here#${TOC}`)]),
      text(" "),
      text("shared", [link(doc(SHARED))]),
      text(" "),
      text("web", [link("https://example.com")]),
      text(" "),
      text("mail", [link("mailto:a@b.c")]),
    );
    const d = docOf(content);
    expect(stripPrivateDocLinks(d.fragment, new Set([SHARED]))).toBe(0);
    expect(d.json()).toEqual(jsonOf(content));
    expect(d.updates()).toBe(0);
  });

  it("also strips our hrefs that don't parse, so no key leaves in them", () => {
    // An invalid or later-form href may still carry a real key; sharing
    // never sends one (§4.6's "never modified" is about editing).
    const d = docOf(
      paragraph(
        text("later", [link("tinydocy:folder/abc")]),
        text(" "),
        text("bad", [link(`TINYDOCY:doc/${PRIVATE}`)]),
        text(" "),
        text("odd", [link(`\u00a0tinydocy:doc/${PRIVATE}`)]),
      ),
    );
    expect(countPrivateDocLinks(d.fragment, new Set([PRIVATE]))).toBe(3);
    expect(stripPrivateDocLinks(d.fragment, new Set([PRIVATE]))).toBe(3);
    expect(d.json()).toEqual(jsonOf(paragraph(text("later bad odd"))));
  });

  it("counts what it would strip without writing (the consent line)", () => {
    const d = docOf(
      paragraph(
        text("a", [link(doc(PRIVATE))]),
        text(" and "),
        text("again", [link(doc(PRIVATE))]),
      ),
    );
    expect(countPrivateDocLinks(d.fragment, new Set())).toBe(2);
    expect(d.updates()).toBe(0);
    expect(stripPrivateDocLinks(d.fragment, new Set())).toBe(2);
  });

  it("never touches other marks or the text", () => {
    const d = docOf(
      paragraph(
        text("a "),
        text("bold link", [bold, link(doc(PRIVATE))]),
        text(" b", [bold]),
      ),
    );
    expect(stripPrivateDocLinks(d.fragment, new Set())).toBe(1);
    expect(d.json()).toEqual(
      jsonOf(paragraph(text("a "), text("bold link b", [bold]))),
    );
  });

  it("counts a link split by bold as one, and back-to-back different hrefs apart", () => {
    const d = docOf(
      paragraph(
        text("Q4 ", [link(doc(PRIVATE))]),
        text("bud", [bold, link(doc(PRIVATE))]),
        text("get", [link(doc(PRIVATE))]),
        text("other", [link(doc(OTHER))]),
        text(" and "),
        text("again", [link(doc(PRIVATE))]),
      ),
    );
    expect(stripPrivateDocLinks(d.fragment, new Set())).toBe(3);
    expect(d.json()).toEqual(
      jsonOf(
        paragraph(text("Q4 "), text("bud", [bold]), text("getother and again")),
      ),
    );
  });

  it("splits a run at a hard break", () => {
    const d = docOf(
      paragraph(
        text("one", [link(doc(PRIVATE))]),
        { type: "hardBreak" },
        text("two", [link(doc(PRIVATE))]),
      ),
    );
    expect(stripPrivateDocLinks(d.fragment, new Set())).toBe(2);
  });

  it("reaches lists, tables and blockquotes", () => {
    const d = docOf(
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              paragraph(text("item")),
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [paragraph(text("deep", [link(doc(PRIVATE))]))],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                content: [paragraph(text("cell", [link(doc(OTHER, TOC))]))],
              },
            ],
          },
        ],
      },
      {
        type: "blockquote",
        content: [paragraph(text("quoted", [link(doc(PRIVATE))]))],
      },
    );
    expect(stripPrivateDocLinks(d.fragment, new Set())).toBe(3);
    expect(JSON.stringify(d.json())).not.toContain("tinydocy:");
    expect(JSON.stringify(d.json())).toContain("deep");
  });

  it("writes in one transaction, and not at all when nothing is private", () => {
    const d = docOf(
      paragraph(text("a", [link(doc(PRIVATE))])),
      paragraph(text("b", [link(doc(OTHER))])),
      paragraph(text("c", [link(doc(SHARED))])),
    );
    expect(stripPrivateDocLinks(d.fragment, new Set([SHARED]))).toBe(2);
    expect(d.updates()).toBe(1);
    expect(stripPrivateDocLinks(d.fragment, new Set([SHARED]))).toBe(0);
    expect(d.updates()).toBe(1);
  });
});
