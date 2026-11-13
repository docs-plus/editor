import { afterEach, describe, expect, it } from "bun:test";

import type { AnyExtension } from "@tiptap/core";
import { DOMSerializer, type Schema } from "@tiptap/pm/model";
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from "@tiptap/y-tiptap";
import * as Y from "yjs";

import { FontSize, TextColor } from "@/extensions/text-style-marks";
import { createSchemaGuard } from "@/lib/schema-guard";
import {
  FONT_SIZE_TOKENS,
  HIGHLIGHT_TOKENS,
  TEXT_COLOR_TOKENS,
} from "@/lib/text-style-tokens";
import {
  type CollabEditorFixture,
  createCollabEditor,
} from "@/tests/helpers/collab-editor";
import { getEditorSchema } from "@/tests/helpers/editor-schema";

const schema = getEditorSchema();

function render(target: Schema, markName: string, attrs: object): string {
  const node = target.text("x", [target.marks[markName].create(attrs)]);
  const div = document.createElement("div");
  div.appendChild(
    DOMSerializer.fromSchema(target).serializeFragment(
      target.nodes.paragraph.create(null, node).content,
    ),
  );
  return div.innerHTML;
}

/** Deterministic pseudo-random strings over a CSS/HTML-hostile alphabet. */
function randomStrings(count: number, seed = 42): string[] {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789;:()\"'<>/\\ -#=";
  let state = seed;
  const next = () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state;
  };
  return Array.from({ length: count }, () => {
    let out = "";
    for (let i = next() % 41; i > 0; i--)
      out += alphabet[next() % alphabet.length];
    return out;
  });
}

const HOSTILE: unknown[] = [
  "red;background:url(x)",
  'red" onmouseover="alert(1)',
  "</span><script>alert(1)</script>",
  "var(--x)",
  "RED",
  " red",
  "red ",
  "x".repeat(10_000),
  "__proto__",
  "constructor",
  42,
  0,
  true,
  {},
  { color: "red" },
  ["red"],
  null,
  undefined,
];

const CASES = [
  ["textColor", "color", "data-text-color", TEXT_COLOR_TOKENS],
  ["fontSize", "size", "data-font-size", FONT_SIZE_TOKENS],
  ["highlight", "color", "data-highlight", HIGHLIGHT_TOKENS],
] as const;

describe("render-time token enforcement (fuzz)", () => {
  for (const [mark, attr, data, tokens] of CASES) {
    it(`${mark} renders hostile values plain and never throws`, () => {
      for (const value of [...HOSTILE, ...randomStrings(2000)]) {
        const html = render(schema, mark, {
          [attr]: value,
          style: "color:red",
          onclick: "x",
        });
        expect(html).not.toContain("style=");
        expect(html).not.toContain("onclick");
        expect(html).not.toContain("<script");
        const found = new RegExp(`${data}="([^"]*)"`).exec(html)?.[1];
        if (found !== undefined)
          expect(tokens as readonly string[]).toContain(found);
      }
    });

    it(`${mark} renders every token as data-* only`, () => {
      for (const token of tokens) {
        const html = render(schema, mark, { [attr]: token });
        expect(html).toContain(`${data}="${token}"`);
        expect(html).not.toContain("style=");
      }
    });
  }
});

describe("Yjs", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "T" }],
      },
      {
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "styled",
            marks: [
              { type: "fontSize", attrs: { size: "sm" } },
              { type: "textColor", attrs: { color: "teal" } },
            ],
          },
        ],
      },
    ],
  };

  it("the new marks survive a Yjs round trip", () => {
    const ydoc = prosemirrorJSONToYDoc(schema, doc, "default");
    const back = yDocToProsemirrorJSON(ydoc, "default");
    const marks = back.content[1].content[0].marks;
    expect(marks).toEqual(
      expect.arrayContaining([
        { type: "fontSize", attrs: { size: "sm" } },
        { type: "textColor", attrs: { color: "teal" } },
      ]),
    );
  });

  it("concurrent colour and size on the same text both survive", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const base = prosemirrorJSONToYDoc(
      schema,
      {
        ...doc,
        content: [
          doc.content[0],
          {
            type: "paragraph",
            content: [{ type: "text", text: "styled" }],
          },
        ],
      },
      "default",
    );
    Y.applyUpdate(a, Y.encodeStateAsUpdate(base));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(base));
    const textOf = (d: Y.Doc) =>
      (d.getXmlFragment("default").get(1) as Y.XmlElement).get(0) as Y.XmlText;
    textOf(a).format(0, 6, { textColor: { color: "red" } });
    textOf(b).format(0, 6, { fontSize: { size: "lg" } });
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    for (const d of [a, b]) {
      const marks = yDocToProsemirrorJSON(d, "default").content[1].content[0]
        .marks;
      expect(marks).toEqual(
        expect.arrayContaining([
          { type: "textColor", attrs: { color: "red" } },
          { type: "fontSize", attrs: { size: "lg" } },
        ]),
      );
    }
  });
});

describe("N vs N+1 on one Y.Doc (spec §3.1 anti-goal)", () => {
  const fixtures: CollabEditorFixture[] = [];
  afterEach(() => {
    for (const f of fixtures) f.destroy();
    fixtures.length = 0;
  });
  const settle = (ms = 20) => new Promise((r) => setTimeout(r, ms));

  function client(server: Y.Doc | undefined, extensions: AnyExtension[]) {
    let guard: ReturnType<typeof createSchemaGuard> | undefined;
    const f = createCollabEditor({
      server,
      extensions,
      onInvalidContent: (error) => guard?.onInvalidContent(error),
    });
    fixtures.push(f);
    guard = createSchemaGuard(f.fragment, {
      repairDelayMs: () => 0,
      onRepairFailed() {},
    });
    guard.bind({ editor: f.editor, canWrite: () => true });
    return { f, guard };
  }

  it("the N client freezes and deletes nothing; N+1 keeps editing", async () => {
    const n1 = client(undefined, [TextColor, FontSize]);
    const n = client(n1.f.server, []);
    const blocks = () => n1.f.server.getXmlFragment("default").length;
    const before = blocks();
    const sentByN = n.f.outgoing.length;

    // "hello world" starts at 8 (after the 5-letter title).
    n1.f.editor
      .chain()
      .setTextSelection({ from: 8, to: 13 })
      .setTextColor("red")
      .setFontSize("lg")
      .run();
    await settle();

    expect(n.guard.getState()).toBe("outdated");
    expect(n.f.binding()?.invalidContentError).not.toBeNull();
    expect(n.f.outgoing.length).toBe(sentByN);
    expect(blocks()).toBe(before);
    const xml = n1.f.server.getXmlFragment("default").toString();
    expect(xml).toContain("textColor");
    expect(xml).toContain("fontSize");
    expect(xml).toContain("hello");

    expect(n1.guard.getState()).toBe("ok");
    expect(n1.f.editor.isEditable).toBe(true);
    n1.f.editor.chain().setTextSelection(19).insertContent("!").run();
    await settle();
    expect(blocks()).toBe(before);
    expect(n1.f.server.getXmlFragment("default").toString()).toContain("!");
    expect(n.f.outgoing.length).toBe(sentByN);
  });
});
