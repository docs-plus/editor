import { describe, expect, it } from "bun:test";

import { getSchema, type JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";

import { extractLinks, LINK_ROWS_MAX } from "@/lib/links/extract-links";
import { DEFAULT_EXTENSIONS } from "@/tests/helpers/create-test-editor";

/**
 * The links pass at 10,000 document links (linking re-review): it stops at
 * `LINK_ROWS_MAX` rows within 8 ms, median of five warm runs, on a
 * developer machine (about 4–5 ms on an M-series Mac). A timing probe, so
 * it runs only in `bun run test:stress`: a busy machine or a shared CI
 * runner measures about twice that. `LINKS_PERF_BUDGET_MS` overrides it.
 */
const schema = getSchema(DEFAULT_EXTENSIONS);
const BUDGET_MS = Number(process.env.LINKS_PERF_BUDGET_MS) || 8;

const paragraph = (key: string): JSONContent => ({
  type: "paragraph",
  content: [
    {
      type: "text",
      text: "x",
      marks: [{ type: "hyperlink", attrs: { href: `tinydocy:doc/${key}` } }],
    },
  ],
});

describe("links pass at 10,000 links", () => {
  it(`stops at ${LINK_ROWS_MAX} rows within ${BUDGET_MS} ms`, () => {
    const keys = Array.from({ length: 10_000 }, (_, i) =>
      i.toString(16).padStart(32, "0"),
    );
    const fragment = prosemirrorJSONToYDoc(
      schema,
      {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: {
              level: 1,
              "data-toc-id": "11111111-1111-4111-8111-111111111111",
            },
            content: [{ type: "text", text: "Title" }],
          },
          ...keys.map(paragraph),
        ],
      },
      "default",
    ).getXmlFragment("default");
    extractLinks(fragment); // warm-up
    const runs = [0, 1, 2, 3, 4]
      .map(() => {
        const started = performance.now();
        extractLinks(fragment);
        return performance.now() - started;
      })
      .sort((a, b) => a - b);
    console.log(
      `extractLinks, 10,000 links: median ${runs[2].toFixed(2)} ms (${runs.map((t) => t.toFixed(2)).join(", ")})`,
    );
    expect(extractLinks(fragment)).toHaveLength(LINK_ROWS_MAX);
    expect(runs[2]).toBeLessThan(BUDGET_MS);
  });
});
