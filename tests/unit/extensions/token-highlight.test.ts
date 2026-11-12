import { describe, expect, it } from "bun:test";

import type { Extension } from "@tiptap/core";

import { TokenHighlight } from "@/extensions/token-highlight";
import { highlightTokenFromValue } from "@/lib/highlight-tokens";
import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "@/tests/helpers/create-test-editor";
import { getEditorSchema } from "@/tests/helpers/editor-schema";

const html = (color: string) =>
  createTestEditor({
    extensions: [
      ...DEFAULT_EXTENSIONS.filter((e) => e.name !== "highlight"),
      TokenHighlight.configure({ multicolor: true }),
    ] as Extension[],
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [
            {
              type: "text",
              text: "t",
              marks: [{ type: "highlight", attrs: { color } }],
            },
          ],
        },
      ],
    },
  }).getHTML();

describe("TokenHighlight", () => {
  it("renders legacy and token values as the same token, without inline style", () => {
    for (const v of ["var(--tt-color-highlight-red)", "red"]) {
      expect(html(v)).toContain('data-highlight="red"');
      expect(html(v)).not.toContain("style=");
    }
    expect(html("teal")).toContain('data-highlight="teal"');
  });

  // the bare <mark> is made transparent by document-editor.scss (`mark:not([data-highlight])`)
  it("renders unknown and hostile values without inline style or token", () => {
    for (const v of [
      "red;background:url(x)",
      "#ff0",
      "var(--background)",
      "cyan",
    ]) {
      expect(html(v)).not.toContain("style=");
      expect(html(v)).toContain("<mark");
      expect(html(v)).not.toContain("data-highlight");
    }
  });

  it("keeps the attribute key color", () => {
    expect(
      Object.keys(getEditorSchema().marks.highlight.spec.attrs ?? {}),
    ).toEqual(["color"]);
  });

  it("maps only tokens and the exact legacy variable", () => {
    expect(highlightTokenFromValue("var(--tt-color-highlight-teal)")).toBe(
      "teal",
    );
    expect(
      highlightTokenFromValue("var(--tt-color-highlight-teal) "),
    ).toBeNull();
    expect(highlightTokenFromValue(null)).toBeNull();
  });
});
