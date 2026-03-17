import type { JSONContent } from "@tiptap/core";
import { afterEach, describe, it } from "vitest";

import { randomInt } from "@/lib/random";
import deeplyNested from "@/tests/fixtures/deeply-nested.json";
import emptyDoc from "@/tests/fixtures/empty-document.json";
import mixedContent from "@/tests/fixtures/mixed-content.json";
import realWorldComplex from "@/tests/fixtures/real-world-complex.json";
import titleOnly from "@/tests/fixtures/title-only.json";
import wideDocument from "@/tests/fixtures/wide-document.json";
import { assertAllInvariants } from "@/tests/helpers/assert-invariants";
import { createTestEditor } from "@/tests/helpers/create-test-editor";
import { generateRandomDocument } from "@/tests/helpers/document-generators";

const FIXTURES: { name: string; content: JSONContent }[] = [
  { name: "empty-document", content: emptyDoc as JSONContent },
  { name: "title-only", content: titleOnly as JSONContent },
  { name: "mixed-content", content: mixedContent as JSONContent },
  { name: "deeply-nested", content: deeplyNested as JSONContent },
  { name: "wide-document", content: wideDocument as JSONContent },
  { name: "real-world-complex", content: realWorldComplex as JSONContent },
];

describe("schema invariants", () => {
  afterEach(() => {
    // Cleanup handled per-test
  });

  describe("fixture documents", () => {
    for (const { name, content } of FIXTURES) {
      it(`assertAllInvariants passes for ${name} (skipUniqueIds for raw fixture)`, () => {
        const editor = createTestEditor({ content });
        assertAllInvariants(editor.state.doc, editor.schema, {
          skipUniqueIds: true,
        });
        editor.destroy();
      });
    }
  });

  describe("generated documents", () => {
    it("10 random docs: assertAllInvariants holds (skipUniqueIds)", () => {
      for (let i = 0; i < 10; i++) {
        const generated = generateRandomDocument({
          minSections: 1,
          maxSections: 15,
          maxDepth: 6,
        });
        const editor = createTestEditor({
          content: generated as unknown as JSONContent,
        });
        assertAllInvariants(editor.state.doc, editor.schema, {
          skipUniqueIds: true,
        });
        editor.destroy();
      }
    });
  });

  describe("random transactions", () => {
    it("10 random transactions per doc: invariants hold after each", () => {
      for (let i = 0; i < 5; i++) {
        const generated = generateRandomDocument({
          minSections: 2,
          maxSections: 8,
          maxDepth: 4,
        });
        const editor = createTestEditor({
          content: generated as unknown as JSONContent,
        });

        for (let t = 0; t < 10; t++) {
          const doc = editor.state.doc;
          const action = randomInt(0, 3);

          try {
            switch (action) {
              case 0: {
                const positions: number[] = [];
                doc.descendants((node, pos) => {
                  if (node.isText) positions.push(pos);
                });
                if (positions.length > 0) {
                  const pos = positions[randomInt(0, positions.length - 1)];
                  editor
                    .chain()
                    .focus()
                    .setTextSelection(pos)
                    .insertContent("x")
                    .run();
                }
                break;
              }
              case 1: {
                editor
                  .chain()
                  .focus()
                  .setTextSelection(doc.content.size - 1)
                  .insertContent({
                    type: "paragraph",
                    content: [{ type: "text", text: `Insert ${i}-${t}` }],
                  })
                  .run();
                break;
              }
              case 2: {
                const maxPos = doc.content.size;
                if (maxPos > 4) {
                  const from = randomInt(1, maxPos - 2);
                  const to = Math.min(from + randomInt(1, 5), maxPos - 1);
                  editor
                    .chain()
                    .focus()
                    .setTextSelection({ from, to })
                    .deleteSelection()
                    .run();
                }
                break;
              }
              case 3: {
                editor
                  .chain()
                  .focus()
                  .setTextSelection(doc.content.size - 1)
                  .insertContent({
                    type: "heading",
                    attrs: { level: randomInt(1, 6) },
                    content: [
                      {
                        type: "text",
                        text: `New H${randomInt(1, 6)} ${i}-${t}`,
                      },
                    ],
                  })
                  .run();
                break;
              }
            }
          } catch {
            // Some operations may throw for invalid positions
          }

          assertAllInvariants(editor.state.doc, editor.schema, {
            skipUniqueIds: true,
          });
        }

        editor.destroy();
      }
    });
  });
});
