import { describe, expect, it } from "vitest";

import {
  assertAllInvariants,
  assertFirstNodeIsH1,
} from "@/tests/helpers/assert-invariants";
import { createTestEditor } from "@/tests/helpers/create-test-editor";
import { doc, h1, h2, p } from "@/tests/helpers/document-builders";
import { generateRandomDocument } from "@/tests/helpers/document-generators";

describe("createTestEditor", () => {
  it("creates a headless editor with default extensions", () => {
    const editor = createTestEditor();
    expect(editor).toBeDefined();
    expect(editor.schema).toBeDefined();
    expect(editor.state.doc).toBeDefined();
    editor.destroy();
  });

  it("accepts custom content", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        ],
      },
    });
    expect(editor.state.doc.firstChild?.textContent).toBe("Title");
    editor.destroy();
  });
});

describe("document-builders", () => {
  it("builds a valid doc with h1, h2, p", () => {
    const built = doc(h1("Title"), h2("Section"), p("Content"));
    expect(built.type.name).toBe("doc");
    expect(built.childCount).toBe(3);
    assertFirstNodeIsH1(built);
  });
});

describe("assert-invariants", () => {
  it("assertAllInvariants passes on valid doc (skipUniqueIds for fixture docs)", () => {
    const editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Body" }] },
        ],
      },
    });
    const docNode = editor.state.doc;
    assertAllInvariants(docNode, editor.schema, { skipUniqueIds: true });
    editor.destroy();
  });
});

describe("document-generators", () => {
  it("generates valid doc structure", () => {
    const generated = generateRandomDocument({
      minSections: 2,
      maxSections: 3,
    });
    expect(generated.type).toBe("doc");
    expect(Array.isArray(generated.content)).toBe(true);
    const first = generated.content[0] as {
      type: string;
      attrs?: { level?: number };
    };
    expect(first?.type).toBe("heading");
    expect(first?.attrs?.level).toBe(1);
  });
});
