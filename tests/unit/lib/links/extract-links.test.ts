import { describe, expect, it } from "bun:test";

import { getSchema, type JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import type * as Y from "yjs";

import {
  extractLinks,
  type LinkRow,
  linksHash,
} from "@/lib/links/extract-links";
import { DEFAULT_EXTENSIONS } from "@/tests/helpers/create-test-editor";

const schema = getSchema(DEFAULT_EXTENSIONS);

const KEY_A = "0123456789abcdef0123456789abcdef";
const KEY_B = "fedcba9876543210fedcba9876543210";
const TOC_1 = "11111111-1111-4111-8111-111111111111";
const TOC_2 = "22222222-2222-4222-8222-222222222222";
const TOC_T = "33333333-3333-4333-8333-333333333333";

type Mark = NonNullable<JSONContent["marks"]>[number];

function link(href: string, attrs: Record<string, unknown> = {}): Mark {
  return { type: "hyperlink", attrs: { href, ...attrs } };
}

function text(value: string, marks: Mark[] = []): JSONContent {
  return marks.length > 0
    ? { type: "text", text: value, marks }
    : { type: "text", text: value };
}

function heading(
  tocId: string | null,
  content: JSONContent[],
  level = 1,
): JSONContent {
  const attrs: Record<string, unknown> = { level };
  if (tocId) attrs["data-toc-id"] = tocId;
  return { type: "heading", attrs, content };
}

function paragraph(...content: JSONContent[]): JSONContent {
  return { type: "paragraph", content };
}

function fragmentOf(...content: JSONContent[]): Y.XmlFragment {
  const doc = prosemirrorJSONToYDoc(
    schema,
    { type: "doc", content },
    "default",
  );
  return doc.getXmlFragment("default");
}

describe("extractLinks", () => {
  it("relies on hyperlink excluding itself, so its Yjs key is `hyperlink`", () => {
    // y-tiptap writes `hyperlink--<hash>` for marks that may overlap.
    const type = schema.marks.hyperlink;
    expect(type.excludes(type)).toBe(true);
  });

  it("returns nothing for a document without links", () => {
    const fragment = fragmentOf(
      heading(TOC_T, [text("Title")]),
      paragraph(text("Plain text, "), text("bold", [{ type: "bold" }])),
    );
    expect(extractLinks(fragment)).toEqual([]);
  });

  it("returns nothing for an empty fragment", () => {
    expect(extractLinks(fragmentOf())).toEqual([]);
  });

  it("emits a row per document link with its section's heading id", () => {
    const fragment = fragmentOf(
      heading(TOC_T, [text("Title")]),
      paragraph(text("See "), text("Q4", [link(`tinydocy:doc/${KEY_A}`)])),
      heading(TOC_2, [text("Travel")], 2),
      paragraph(
        text("Budget at "),
        text("costs", [link(`tinydocy:doc/${KEY_B}#${TOC_1}`)]),
        text("."),
      ),
    );
    expect(extractLinks(fragment)).toEqual([
      {
        srcTocId: TOC_T,
        key: KEY_A,
        tocId: null,
        text: "Q4",
        context: "See Q4",
      },
      {
        srcTocId: TOC_2,
        key: KEY_B,
        tocId: TOC_1,
        text: "costs",
        context: "Budget at costs.",
      },
    ]);
  });

  it("gives null srcTocId when the nearest heading has no id", () => {
    const fragment = fragmentOf(
      heading(null, [
        text("Untitled "),
        text("ref", [link(`tinydocy:doc/${KEY_A}`)]),
      ]),
      paragraph(text("x", [link(`tinydocy:doc/${KEY_B}`)])),
      heading(TOC_2, [text("Has id")], 2),
      paragraph(text("y", [link(`tinydocy:doc/${KEY_A}`)])),
      heading(null, [text("No id")], 2),
      paragraph(text("z", [link(`tinydocy:doc/${KEY_B}`)])),
    );
    expect(
      extractLinks(fragment).map((row) => [row.srcTocId, row.text]),
    ).toEqual([
      [null, "ref"],
      [null, "x"],
      [TOC_2, "y"],
      [null, "z"],
    ]);
  });

  it("uses the heading itself as the section of a link inside it", () => {
    const fragment = fragmentOf(
      heading(TOC_T, [
        text("About "),
        text("plan", [link(`tinydocy:doc/${KEY_A}`)]),
      ]),
    );
    expect(extractLinks(fragment)).toEqual([
      {
        srcTocId: TOC_T,
        key: KEY_A,
        tocId: null,
        text: "plan",
        context: "About plan",
      },
    ]);
  });

  it("skips here#, external and malformed links", () => {
    const fragment = fragmentOf(
      heading(TOC_T, [text("Title")]),
      paragraph(
        text("a", [link(`tinydocy:here#${TOC_1}`)]),
        text(" b", [link("https://example.com")]),
        text(" c", [link(`tinydocy:doc/${KEY_A.toUpperCase()}`)]),
        text(" d", [link(`tinydocy:doc/${KEY_A}x`)]),
        text(" e", [link(`tinydocy://local/${KEY_A}`)]),
        text(" f", [link(`tinydocy:doc/${KEY_A}/extra`)]),
        text(" g", [link("javascript:alert(1)")]),
      ),
    );
    expect(extractLinks(fragment)).toEqual([]);
  });

  it("finds links in lists and tables with the inner block as context", () => {
    const fragment = fragmentOf(
      heading(TOC_T, [text("Title")]),
      {
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              paragraph(text("first item")),
              {
                type: "bulletList",
                content: [
                  {
                    type: "listItem",
                    content: [
                      paragraph(
                        text("nested "),
                        text("deep", [link(`tinydocy:doc/${KEY_A}`)]),
                      ),
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      heading(TOC_2, [text("Table")], 2),
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: [
              { type: "tableCell", content: [paragraph(text("other cell"))] },
              {
                type: "tableCell",
                content: [
                  paragraph(
                    text("in "),
                    text("cell", [link(`tinydocy:doc/${KEY_B}#${TOC_1}`)]),
                  ),
                ],
              },
            ],
          },
        ],
      },
    );
    expect(extractLinks(fragment)).toEqual([
      {
        srcTocId: TOC_T,
        key: KEY_A,
        tocId: null,
        text: "deep",
        context: "nested deep",
      },
      {
        srcTocId: TOC_2,
        key: KEY_B,
        tocId: TOC_1,
        text: "cell",
        context: "in cell",
      },
    ]);
  });

  it("finds links in blockquotes and task lists", () => {
    const fragment = fragmentOf(
      heading(TOC_T, [text("Title")]),
      {
        type: "blockquote",
        content: [
          paragraph(
            text("quoted "),
            text("q", [link(`tinydocy:doc/${KEY_A}`)]),
          ),
        ],
      },
      {
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { checked: false },
            content: [
              paragraph(
                text("todo "),
                text("t", [link(`tinydocy:doc/${KEY_B}`)]),
              ),
            ],
          },
        ],
      },
    );
    expect(extractLinks(fragment).map((row) => row.context)).toEqual([
      "quoted q",
      "todo t",
    ]);
  });

  it("emits two rows for two links in one paragraph, in order", () => {
    const fragment = fragmentOf(
      heading(TOC_T, [text("Title")]),
      paragraph(
        text("one", [link(`tinydocy:doc/${KEY_A}`)]),
        text(" and "),
        text("two", [link(`tinydocy:doc/${KEY_B}`)]),
      ),
    );
    const rows = extractLinks(fragment);
    expect(rows.map((row) => [row.key, row.text, row.context])).toEqual([
      [KEY_A, "one", "one and two"],
      [KEY_B, "two", "one and two"],
    ]);
  });

  it("merges a link split across delta items (part bold) into one row", () => {
    const href = `tinydocy:doc/${KEY_A}#${TOC_1}`;
    const fragment = fragmentOf(
      heading(TOC_T, [text("Title")]),
      paragraph(
        text("See "),
        text("Q4 ", [link(href)]),
        text("bud", [{ type: "bold" }, link(href)]),
        text("get", [{ type: "italic" }, link(href)]),
        text(" now"),
      ),
    );
    expect(extractLinks(fragment)).toEqual([
      {
        srcTocId: TOC_T,
        key: KEY_A,
        tocId: TOC_1,
        text: "Q4 budget",
        context: "See Q4 budget now",
      },
    ]);
  });

  it("keeps adjacent links with different hrefs apart, even to one document", () => {
    const fragment = fragmentOf(
      heading(TOC_T, [text("Title")]),
      paragraph(
        text("doc", [link(`tinydocy:doc/${KEY_A}`)]),
        text("section", [link(`tinydocy:doc/${KEY_A}#${TOC_1}`)]),
      ),
    );
    expect(extractLinks(fragment).map((row) => [row.text, row.tocId])).toEqual([
      ["doc", null],
      ["section", TOC_1],
    ]);
  });

  it("ends a link at a hard break and reads the break as a space", () => {
    const href = `tinydocy:doc/${KEY_A}`;
    const fragment = fragmentOf(
      heading(TOC_T, [text("Title")]),
      paragraph(
        text("up", [link(href)]),
        { type: "hardBreak" },
        text("down", [link(href)]),
      ),
    );
    expect(
      extractLinks(fragment).map((row) => [row.text, row.context]),
    ).toEqual([
      ["up", "up down"],
      ["down", "up down"],
    ]);
  });

  it("truncates context to 160 characters centred on the link", () => {
    const before = Array.from({ length: 40 }, (_, i) => `before${i}`).join(" ");
    const after = Array.from({ length: 40 }, (_, i) => `after${i}`).join(" ");
    const fragment = fragmentOf(
      heading(TOC_T, [text("Title")]),
      paragraph(
        text(`${before} `),
        text("the target", [link(`tinydocy:doc/${KEY_A}`)]),
        text(` ${after}`),
      ),
    );
    const [row] = extractLinks(fragment);
    expect(row.context.length).toBeLessThanOrEqual(160);
    expect(row.context.length).toBeGreaterThan(120);
    expect(row.context.startsWith("…")).toBe(true);
    expect(row.context.endsWith("…")).toBe(true);
    expect(row.context).toContain("the target");
    // Centred: roughly as much text on each side of the link.
    const at = row.context.indexOf("the target");
    const left = at;
    const right = row.context.length - (at + "the target".length);
    expect(Math.abs(left - right)).toBeLessThan(20);
    // Cut at word boundaries: no partial word next to the ellipses.
    const words = row.context.slice(1, -1).trim().split(" ");
    for (const word of words) {
      expect(`${before} the target ${after}`.split(" ")).toContain(word);
    }
  });

  it("keeps a long context unchanged up to 160 characters", () => {
    const filler = "x".repeat(150);
    const fragment = fragmentOf(
      heading(TOC_T, [text("Title")]),
      paragraph(
        text(`${filler} `),
        text("link", [link(`tinydocy:doc/${KEY_A}`)]),
      ),
    );
    const [row] = extractLinks(fragment);
    expect(row.context).toBe(`${filler} link`);
    expect(row.context.length).toBe(155);
  });

  it("truncates with only one ellipsis when the link is near the start", () => {
    const after = Array.from({ length: 40 }, (_, i) => `after${i}`).join(" ");
    const fragment = fragmentOf(
      heading(TOC_T, [text("Title")]),
      paragraph(
        text("start", [link(`tinydocy:doc/${KEY_A}`)]),
        text(` ${after}`),
      ),
    );
    const [row] = extractLinks(fragment);
    expect(row.context.startsWith("start after0")).toBe(true);
    expect(row.context.endsWith("…")).toBe(true);
    expect(row.context.length).toBeLessThanOrEqual(160);
  });

  it("never splits a surrogate pair when truncating", () => {
    const fragment = fragmentOf(
      heading(TOC_T, [text("Title")]),
      paragraph(
        text("😀".repeat(100)),
        text("x", [link(`tinydocy:doc/${KEY_A}`)]),
        text("😀".repeat(100)),
      ),
    );
    const [row] = extractLinks(fragment);
    expect(row.context.length).toBeLessThanOrEqual(160);
    expect(row.context).toContain("x");
    expect(row.context).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(row.context).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });

  it("reads only document-link text and its own block, nothing else", () => {
    const SECRET = "SENTINEL";
    const fragment = fragmentOf(
      heading(TOC_T, [text(`Title ${SECRET}1`)]),
      paragraph(text(`Sibling ${SECRET}2`)),
      paragraph(
        text("Link to "),
        text("Q4", [
          link(`tinydocy:doc/${KEY_A}`, {
            title: `${SECRET}3`,
            class: `${SECRET}4`,
          }),
          { type: "textColor", attrs: { color: `${SECRET}5` } } as Mark,
        ]),
      ),
      paragraph(
        text(`${SECRET}6`, [{ type: "bold" }]),
        text(" ext", [link(`https://${SECRET}7.example`)]),
      ),
      paragraph(
        text("here", [link(`tinydocy:here#${TOC_1}`)]),
        text(` ${SECRET}8`),
      ),
    );
    const rows = extractLinks(fragment);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "context",
        "key",
        "srcTocId",
        "text",
        "tocId",
      ]);
    }
  });
});

describe("linksHash", () => {
  const base: LinkRow[] = [
    { srcTocId: TOC_T, key: KEY_A, tocId: null, text: "Q4", context: "See Q4" },
    { srcTocId: null, key: KEY_B, tocId: TOC_1, text: "x", context: "a x b" },
  ];

  it("is stable for the same rows", () => {
    const copy = base.map((row) => ({ ...row }));
    expect(linksHash(copy)).toBe(linksHash(base));
    expect(linksHash(base)).toMatch(/^[0-9a-f]{8}$/);
  });

  it("is a fixed value for no rows", () => {
    expect(linksHash([])).toBe(linksHash([]));
    expect(linksHash([])).not.toBe(linksHash(base));
  });

  it("changes when any field changes", () => {
    const original = linksHash(base);
    const variants: Partial<LinkRow>[] = [
      { srcTocId: TOC_2 },
      { srcTocId: null },
      { key: KEY_B },
      { tocId: TOC_2 },
      { text: "Q5" },
      { context: "See Q4." },
    ];
    for (const change of variants) {
      const rows = [{ ...base[0], ...change }, base[1]];
      expect(linksHash(rows)).not.toBe(original);
    }
  });

  it("tells null from an empty string", () => {
    const withNull: LinkRow[] = [{ ...base[0], tocId: null }];
    const withEmpty: LinkRow[] = [{ ...base[0], tocId: "" }];
    expect(linksHash(withNull)).not.toBe(linksHash(withEmpty));
  });

  it("changes when rows are reordered", () => {
    expect(linksHash([base[1], base[0]])).not.toBe(linksHash(base));
  });
});
