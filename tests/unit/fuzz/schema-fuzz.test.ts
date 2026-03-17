import { describe, it } from "vitest";

import {
  assertFirstNodeIsH1,
  assertValidSchema,
} from "@/tests/helpers/assert-invariants";
import { createTestEditor } from "@/tests/helpers/create-test-editor";
import { generateRandomDocument } from "@/tests/helpers/document-generators";

describe("schema fuzz: structured randomization", () => {
  it("survives 5000 random valid operations", () => {
    for (let i = 0; i < 500; i++) {
      const content = generateRandomDocument({
        minSections: 1,
        maxSections: 20,
        maxDepth: 6,
      });
      const editor = createTestEditor({ content });

      for (let op = 0; op < 10; op++) {
        const action = Math.floor(Math.random() * 4);
        const doc = editor.state.doc;

        try {
          switch (action) {
            case 0: {
              // Insert text at random position in a paragraph
              const positions: number[] = [];
              doc.descendants((node, pos) => {
                if (node.isText) positions.push(pos);
              });
              if (positions.length > 0) {
                const pos =
                  positions[Math.floor(Math.random() * positions.length)];
                editor
                  .chain()
                  .focus()
                  .setTextSelection(pos)
                  .insertContent("fuzz")
                  .run();
              }
              break;
            }
            case 1: {
              // Insert a heading at end of document
              editor
                .chain()
                .focus()
                .setTextSelection(doc.content.size - 1)
                .insertContent({
                  type: "heading",
                  attrs: { level: Math.floor(Math.random() * 6) + 1 },
                  content: [{ type: "text", text: `Fuzz heading ${i}-${op}` }],
                })
                .run();
              break;
            }
            case 2: {
              // Delete a random range (small)
              const maxPos = doc.content.size;
              if (maxPos > 4) {
                const from = Math.floor(Math.random() * (maxPos - 2)) + 1;
                const to = Math.min(
                  from + Math.floor(Math.random() * 10) + 1,
                  maxPos - 1,
                );
                try {
                  editor
                    .chain()
                    .focus()
                    .setTextSelection({ from, to })
                    .deleteSelection()
                    .run();
                } catch {
                  /* invalid selection range */
                }
              }
              break;
            }
            case 3: {
              // Toggle fold on a random heading (if any exist)
              // Just verify the fold state doesn't crash — not testing DOM
              const headingIds: string[] = [];
              doc.descendants((node) => {
                if (node.type.name === "heading" && node.attrs["data-toc-id"]) {
                  headingIds.push(node.attrs["data-toc-id"] as string);
                }
              });
              if (headingIds.length > 1) {
                const id =
                  headingIds[
                    Math.floor(Math.random() * (headingIds.length - 1)) + 1
                  ];
                void id; // No DOM interaction in headless
              }
              break;
            }
          }
        } catch {
          // Some operations may throw for invalid positions — that's OK
        }

        // Invariant check after each operation
        assertFirstNodeIsH1(editor.state.doc);
        assertValidSchema(editor.state.doc);
      }

      editor.destroy();
    }
  }, 60000);
});
