import { describe, expect, it } from "bun:test";

import type { Extension } from "@tiptap/core";

import { isColorHighlightActive } from "@/components/tiptap-ui/color-highlight-button/use-color-highlight";
import {
  activeHighlightToken,
  TokenHighlight,
} from "@/extensions/token-highlight";
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

  describe("token values (B4)", () => {
    const P = 8;
    const make = () =>
      createTestEditor({
        content: {
          type: "doc",
          content: [
            {
              type: "heading",
              attrs: { level: 1 },
              content: [{ type: "text", text: "Title" }],
            },
            {
              type: "paragraph",
              content: [{ type: "text", text: "hello world" }],
            },
          ],
        },
      });
    const colors = (editor: ReturnType<typeof make>) => {
      const out: unknown[] = [];
      editor.state.doc.descendants((node) => {
        for (const m of node.marks)
          if (m.type.name === "highlight") out.push(m.attrs.color);
      });
      return out;
    };

    it("stores the token for a token or the legacy form", () => {
      const editor = make();
      editor
        .chain()
        .setTextSelection({ from: P, to: P + 5 })
        .setHighlight({ color: "red" })
        .run();
      expect(colors(editor)).toEqual(["red"]);
      editor.commands.setHighlight({ color: "var(--tt-color-highlight-blue)" });
      expect(colors(editor)).toEqual(["blue"]);
      expect(editor.getHTML()).toContain('data-highlight="blue"');
    });

    /** "hello" highlighted with a raw stored value, selected. */
    const marked = (color: string) => {
      const editor = make();
      editor
        .chain()
        .setTextSelection({ from: P, to: P + 5 })
        .setMark("highlight", { color })
        .run();
      return editor;
    };
    const modShiftH = (editor: ReturnType<typeof make>) =>
      editor.commands.keyboardShortcut("Mod-Shift-h");

    describe("Mod-Shift-H removes any highlight in one press", () => {
      for (const color of [
        "red",
        "yellow",
        "var(--tt-color-highlight-yellow)",
        "var(--tt-color-highlight-red)",
      ]) {
        it(`on ${color}`, () => {
          const editor = marked(color);
          expect(colors(editor)).toEqual([color]);
          modShiftH(editor);
          expect(colors(editor)).toEqual([]);
        });
      }

      it("and sets yellow on plain text", () => {
        const editor = make();
        editor.commands.setTextSelection({ from: P, to: P + 5 });
        modShiftH(editor);
        expect(colors(editor)).toEqual(["yellow"]);
        modShiftH(editor);
        expect(colors(editor)).toEqual([]);
      });
    });

    it("toggling a colour compares tokens, not raw values", () => {
      // legacy value, bare token: removes
      let editor = marked("var(--tt-color-highlight-yellow)");
      editor.commands.toggleHighlight({ color: "yellow" });
      expect(colors(editor)).toEqual([]);
      // bare value, legacy swatch: removes
      editor = marked("yellow");
      editor.commands.toggleHighlight({
        color: "var(--tt-color-highlight-yellow)",
      });
      expect(colors(editor)).toEqual([]);
      // another colour: replaces with the token
      editor = marked("var(--tt-color-highlight-yellow)");
      editor.commands.toggleHighlight({
        color: "var(--tt-color-highlight-red)",
      });
      expect(colors(editor)).toEqual(["red"]);
    });

    it("activeHighlightToken maps legacy values and ignores unknown ones", () => {
      expect(
        activeHighlightToken(marked("var(--tt-color-highlight-teal)").state),
      ).toBe("teal");
      expect(activeHighlightToken(marked("teal").state)).toBe("teal");
      expect(activeHighlightToken(marked("#ff0").state)).toBeNull();
      const plain = make();
      plain.commands.setTextSelection({ from: P, to: P + 5 });
      expect(activeHighlightToken(plain.state)).toBeNull();
      // empty selection: the stored mark counts
      plain.commands.setTextSelection(P + 11);
      plain.commands.setHighlight({ color: "green" });
      expect(activeHighlightToken(plain.state)).toBe("green");
    });

    it("the release N popover reads a Mod-Shift-H highlight as its swatch", () => {
      const editor = make();
      editor.commands.setTextSelection({ from: P, to: P + 5 });
      modShiftH(editor);
      expect(
        isColorHighlightActive(editor, "var(--tt-color-highlight-yellow)"),
      ).toBe(true);
      expect(
        isColorHighlightActive(editor, "var(--tt-color-highlight-red)"),
      ).toBe(false);
      expect(isColorHighlightActive(editor, "var(--background)")).toBe(false);
      expect(isColorHighlightActive(editor)).toBe(true);
    });

    it("defaults to yellow for toggleHighlight() and ==x==", () => {
      const editor = make();
      editor
        .chain()
        .setTextSelection({ from: P, to: P + 5 })
        .toggleHighlight()
        .run();
      expect(colors(editor)).toEqual(["yellow"]);
      editor.commands.setTextSelection(P + 11);
      editor.view.pasteText(" ==hi== ");
      expect(colors(editor)).toEqual(["yellow", "yellow"]);
    });

    it("refuses non-token values and changes nothing", () => {
      const editor = make();
      editor.commands.setTextSelection({ from: P, to: P + 5 });
      for (const v of ["#ff0", "var(--background)", "red;x", "__proto__"]) {
        expect(editor.commands.setHighlight({ color: v })).toBe(false);
        expect(editor.commands.toggleHighlight({ color: v })).toBe(false);
      }
      expect(colors(editor)).toEqual([]);
    });

    it("toggles off a highlight set with the legacy form", () => {
      const editor = make();
      const legacy = { color: "var(--tt-color-highlight-blue)" };
      editor
        .chain()
        .setTextSelection({ from: P, to: P + 5 })
        .toggleHighlight(legacy)
        .toggleHighlight(legacy)
        .run();
      expect(colors(editor)).toEqual([]);
    });

    it("parses own tokens (N and N+1 copies) and drops foreign backgrounds", () => {
      const editor = make();
      editor.commands.setContent(
        '<h1>t</h1><p><mark data-highlight="teal">a</mark><mark data-color="var(--tt-color-highlight-red)">b</mark><mark style="background-color: red">c</mark><span style="background-color:#ff0">d</span><mark>e</mark></p>',
      );
      expect(colors(editor)).toEqual(["teal", "red"]);
      expect(editor.getText()).toContain("abcde");
    });

    it("renders the token, not the raw legacy value, in data-color", () => {
      expect(html("var(--tt-color-highlight-red)")).toContain(
        'data-color="red"',
      );
    });
  });
});
