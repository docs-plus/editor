import type { JSONContent } from "@tiptap/core";
import { describe, expect, test } from "vitest";
import { headingFilterPluginKey } from "@/components/tiptap-node/heading-node/heading-filter-plugin";
import { headingFoldPluginKey } from "@/components/tiptap-node/heading-node/heading-fold-plugin";
import { createTestEditor } from "@/tests/helpers/create-test-editor";

type DocumentShape = "flat" | "deep";

const DEEP_LEVELS: Array<1 | 2 | 3 | 4 | 5 | 6> = [1, 2, 3, 4, 5, 6];

function generateDocumentWithShape(
  headingCount: number,
  shape: DocumentShape,
): JSONContent {
  const content: JSONContent[] = [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Document Title" }],
    },
    {
      type: "paragraph",
      content: [{ type: "text", text: "Title body paragraph." }],
    },
  ];

  for (let i = 1; i < headingCount; i++) {
    const level =
      shape === "flat" ? 1 : DEEP_LEVELS[(i - 1) % DEEP_LEVELS.length];
    content.push(
      {
        type: "heading",
        attrs: { level },
        content: [{ type: "text", text: `Heading ${i}` }],
      },
      {
        type: "paragraph",
        content: [{ type: "text", text: `Body of heading ${i}.` }],
      },
    );
  }

  return { type: "doc", content };
}

function collectParagraphPositions(
  doc: ReturnType<typeof createTestEditor>["state"]["doc"],
): number[] {
  const positions: number[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name === "paragraph" && node.content.size > 0) {
      positions.push(pos + 1);
    }
  });
  return positions;
}

function collectHeadingInfo(
  doc: ReturnType<typeof createTestEditor>["state"]["doc"],
): Array<{ pos: number; endPos: number; tocId: string }> {
  const headings: Array<{ pos: number; endPos: number; tocId: string }> = [];
  let index = 0;
  doc.descendants((node, pos) => {
    if (node.type.name === "heading") {
      const tocId = (node.attrs as Record<string, unknown>)["data-toc-id"];
      if (typeof tocId === "string" && tocId && index > 0) {
        headings.push({ pos, endPos: pos + node.nodeSize, tocId });
      }
      index++;
    }
  });
  return headings;
}

function findSectionEnd(
  doc: ReturnType<typeof createTestEditor>["state"]["doc"],
  headingPos: number,
  headingLevel: number,
): number {
  let end = doc.content.size;
  let pastTarget = false;
  doc.descendants((node, pos) => {
    if (node.type.name !== "heading") return;
    if (pos === headingPos) {
      pastTarget = true;
      return;
    }
    if (
      pastTarget &&
      (node.attrs as Record<string, unknown>).level <= headingLevel
    ) {
      if (pos < end) end = pos;
    }
  });
  return end;
}

type TransactionType =
  | "textInsert"
  | "headingInsert"
  | "headingDelete"
  | "foldToggle"
  | "filterApply";

const TX_TYPES: TransactionType[] = [
  "textInsert",
  "headingInsert",
  "headingDelete",
  "foldToggle",
  "filterApply",
];

function dispatchTransaction(
  editor: ReturnType<typeof createTestEditor>,
  txType: TransactionType,
): void {
  const { state, view } = editor;

  switch (txType) {
    case "textInsert": {
      const paragraphs = collectParagraphPositions(state.doc);
      if (paragraphs.length === 0) return;
      const pos = paragraphs[Math.floor(Math.random() * paragraphs.length)];
      const { tr } = state;
      tr.insertText("abcdefghij", pos);
      view.dispatch(tr);
      break;
    }

    case "headingInsert": {
      const headings = collectHeadingInfo(state.doc);
      if (headings.length === 0) return;
      const target = headings[Math.floor(Math.random() * headings.length)];
      const headingNode = state.schema.nodes.heading.create(
        { level: 2 },
        state.schema.text("New heading"),
      );
      const para = state.schema.nodes.paragraph.create(
        null,
        state.schema.text("Inserted content"),
      );
      const { tr } = state;
      tr.insert(target.endPos, [headingNode, para]);
      view.dispatch(tr);
      break;
    }

    case "headingDelete": {
      const headings = collectHeadingInfo(state.doc);
      if (headings.length < 2) return;
      const idx = Math.floor(Math.random() * headings.length);
      const heading = headings[idx];
      const headingNode = state.doc.nodeAt(heading.pos);
      if (!headingNode) return;
      const level = (headingNode.attrs as Record<string, unknown>)
        .level as number;
      const sectionEnd = findSectionEnd(state.doc, heading.pos, level);
      const { tr } = state;
      tr.delete(heading.pos, sectionEnd);
      view.dispatch(tr);
      break;
    }

    case "foldToggle": {
      const headings = collectHeadingInfo(state.doc);
      if (headings.length === 0) return;
      const target = headings[Math.floor(Math.random() * headings.length)];
      const { tr } = state;
      tr.setMeta(headingFoldPluginKey, { type: "toggle", id: target.tocId });
      view.dispatch(tr);
      break;
    }

    case "filterApply": {
      const { tr } = state;
      tr.setMeta(headingFilterPluginKey, {
        type: "preview",
        query: "Heading",
      });
      view.dispatch(tr);
      break;
    }
  }
}

function measureTransactionP95(
  headingCount: number,
  shape: DocumentShape,
): number {
  const doc = generateDocumentWithShape(headingCount, shape);
  const editor = createTestEditor({ content: doc });

  for (let i = 0; i < 20; i++) {
    try {
      dispatchTransaction(editor, "textInsert");
    } catch {
      /* warm-up — safe to skip */
    }
  }

  const timings: number[] = [];

  for (let i = 0; i < 100; i++) {
    const txType = TX_TYPES[i % TX_TYPES.length];
    try {
      const start = performance.now();
      dispatchTransaction(editor, txType);
      timings.push(performance.now() - start);
    } catch {
      /* position may be invalid after structural changes */
    }
  }

  editor.destroy();

  if (timings.length === 0) return Number.POSITIVE_INFINITY;

  timings.sort((a, b) => a - b);
  const p95Index = Math.floor(timings.length * 0.95);
  return timings[Math.min(p95Index, timings.length - 1)];
}

function binarySearchCeiling(shape: DocumentShape): number {
  let low = 10;
  let high = 2000;

  while (high - low > 5) {
    const mid = Math.floor((low + high) / 2);
    const p95 = measureTransactionP95(mid, shape);

    if (p95 < 16) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return low;
}

describe("headless stress probe", { timeout: 60_000 }, () => {
  test("flat shape: ceiling >= 200 headings under 16ms p95", () => {
    const ceiling = binarySearchCeiling("flat");
    console.log(`Flat shape ceiling: ${ceiling} headings`);
    expect(ceiling).toBeGreaterThanOrEqual(200);
  });

  test("deep shape: ceiling >= 200 headings under 16ms p95", () => {
    const ceiling = binarySearchCeiling("deep");
    console.log(`Deep shape ceiling: ${ceiling} headings`);
    expect(ceiling).toBeGreaterThanOrEqual(200);
  });
});
