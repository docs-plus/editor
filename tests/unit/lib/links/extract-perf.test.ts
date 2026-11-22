import { beforeAll, describe, expect, it } from "bun:test";

import * as Y from "yjs";

import { deriveDocument } from "@/lib/links/extract-links";

/**
 * The derive pass blocks its thread, so it has a budget: under 8 ms
 * (median of 5 warm runs) for 500 headings in about 2 MiB of Yjs state.
 * A slow CI machine can raise it with `LINKS_PERF_BUDGET_MS`.
 */
const BUDGET_MS = Number(process.env.LINKS_PERF_BUDGET_MS) || 8;
const HEADINGS = 500;
const PARAGRAPHS_PER_SECTION = 4;
const RUNS = 5;
const MIN_BYTES = 1.9 * 1024 * 1024;
const KEY = "0123456789abcdef0123456789abcdef";
/** About 1 KB of prose. */
const PROSE = "lorem ipsum dolor sit amet consectetur adipiscing ".repeat(21);

function tocId(index: number): string {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** Built as y-tiptap stores it: heading/paragraph elements over XmlText. */
function buildLargeDocument(): Y.Doc {
  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");
  ydoc.transact(() => {
    for (let h = 0; h < HEADINGS; h++) {
      const heading = new Y.XmlElement("heading");
      const title = new Y.XmlText();
      heading.insert(0, [title]);
      fragment.push([heading]);
      heading.setAttribute("data-toc-id", tocId(h));
      heading.setAttribute("level", ((h % 3) + 1) as unknown as string);
      title.insert(0, `Section ${h}`);
      for (let p = 0; p < PARAGRAPHS_PER_SECTION; p++) {
        const paragraph = new Y.XmlElement("paragraph");
        const body = new Y.XmlText();
        paragraph.insert(0, [body]);
        fragment.push([paragraph]);
        body.insert(0, PROSE);
        if (p === 1) {
          // One document link per section, every fifth to a heading.
          const href =
            h % 5 === 0
              ? `tinydocy:doc/${KEY}#${tocId(h + 1)}`
              : `tinydocy:doc/${KEY}`;
          body.insert(120, "the budget", { hyperlink: { href } });
        }
        if (p === 2) body.format(40, 12, { bold: {} });
      }
    }
  });
  return ydoc;
}

describe("deriveDocument performance", () => {
  let ydoc: Y.Doc;

  beforeAll(() => {
    ydoc = buildLargeDocument();
  });

  it("covers a document of about 2 MiB with 500 headings", () => {
    expect(Y.encodeStateAsUpdate(ydoc).byteLength).toBeGreaterThan(MIN_BYTES);
    const derived = deriveDocument(ydoc.getXmlFragment("default"));
    expect(derived.headings).toHaveLength(HEADINGS);
    expect(derived.links).toHaveLength(HEADINGS);
  });

  it(`takes under ${BUDGET_MS} ms (median of ${RUNS} warm runs)`, () => {
    const fragment = ydoc.getXmlFragment("default");
    deriveDocument(fragment);
    const times: number[] = [];
    for (let run = 0; run < RUNS; run++) {
      const start = performance.now();
      deriveDocument(fragment);
      times.push(performance.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(RUNS / 2)];
    console.info(
      `deriveDocument, 500 headings / 2 MiB: median ${median.toFixed(2)} ms (${times.map((t) => t.toFixed(2)).join(", ")})`,
    );
    expect(median).toBeLessThan(BUDGET_MS);
  });
});
