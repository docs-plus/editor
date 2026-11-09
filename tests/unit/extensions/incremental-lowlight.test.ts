import type { Editor, Extension, JSONContent } from "@tiptap/core";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  incrementalLowlightPluginKey,
  tokenizeCodeBlock,
} from "@/components/document-editor/incremental-lowlight";
import { SafeCodeBlock } from "@/components/document-editor/safe-code-block";
import { lowlight } from "@/lib/lowlight";

import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";

const countingLowlight = {
  ...lowlight,
  highlight: vi.fn(lowlight.highlight),
};

const EXTENSIONS = [
  ...DEFAULT_EXTENSIONS.filter((extension) => extension.name !== "codeBlock"),
  SafeCodeBlock.configure({ lowlight: countingLowlight }),
] as Extension[];

const code = (language: string, text: string): JSONContent => ({
  type: "codeBlock",
  attrs: { language },
  content: [{ type: "text", text }],
});
const paragraph = (text: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text }],
});

const CONTENT: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "Title" }],
    },
    code("js", "const a = 1;"),
    paragraph("between"),
    code("python", "def f(x):\n    return 'x'"),
    paragraph("after"),
  ],
};

let editor: Editor | undefined;
afterEach(() => {
  editor?.destroy();
  countingLowlight.highlight.mockClear();
});

function setup(content: JSONContent = CONTENT) {
  editor = createTestEditor({ content, extensions: EXTENSIONS });
  countingLowlight.highlight.mockClear();
  return editor;
}

type Span = [from: number, to: number, className: string];

/** Decorations the plugin currently holds, in document order. */
function actualSpans(instance: Editor): Span[] {
  const set = incrementalLowlightPluginKey.getState(instance.state);
  return (set?.find() ?? [])
    .map(
      (d) =>
        [
          d.from,
          d.to,
          (d as unknown as { type: { attrs: { class: string } } }).type.attrs
            .class,
        ] as Span,
    )
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}

/** What a full highlight of the current document gives. */
function expectedSpans(doc: ProseMirrorNode): Span[] {
  const spans: Span[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== "codeBlock") return !node.isTextblock;
    for (const token of tokenizeCodeBlock(node, {
      name: "codeBlock",
      lowlight,
    })) {
      spans.push([pos + 1 + token.from, pos + 1 + token.to, token.className]);
    }
    return false;
  });
  return spans;
}

function expectFullyHighlighted(instance: Editor) {
  const spans = actualSpans(instance);
  expect(spans.length).toBeGreaterThan(0);
  expect(spans).toEqual(expectedSpans(instance.state.doc));
}

/** Position just inside the start of the `index`-th code block. */
function codeStart(instance: Editor, index: number): number {
  let found = -1;
  let seen = 0;
  instance.state.doc.descendants((node, pos) => {
    if (found >= 0) return false;
    if (node.type.name === "codeBlock" && seen++ === index) found = pos + 1;
    return !node.isTextblock;
  });
  return found;
}

describe("incremental lowlight", () => {
  it("replaces the stock lowlight plugin", () => {
    const instance = setup();
    const keys = instance.state.plugins.map(
      (plugin) => (plugin as unknown as { key: string }).key,
    );
    expect(keys.some((key) => key.startsWith("lowlight$"))).toBe(false);
    expect(keys).toContain("incrementalLowlight$");
    expectFullyHighlighted(instance);
  });

  it("re-highlights only the code block being edited", () => {
    const instance = setup();
    instance.commands.insertContentAt(codeStart(instance, 1), "x = 2\n");
    expect(countingLowlight.highlight).toHaveBeenCalledTimes(1);
    expect(countingLowlight.highlight.mock.calls[0][0]).toBe("python");
    expectFullyHighlighted(instance);
  });

  it("does not highlight when prose changes, and keeps spans in place", () => {
    const instance = setup();
    instance.commands.insertContentAt(2, "Long ");
    instance.commands.insertContentAt(
      instance.state.doc.content.size - 2,
      " more",
    );
    expect(countingLowlight.highlight).not.toHaveBeenCalled();
    expectFullyHighlighted(instance);
  });

  it("stays correct across edits, joins, splits and deletions", () => {
    const instance = setup();
    const first = codeStart(instance, 0);
    instance.commands.insertContentAt(first + 5, "/* c */ ");
    instance.commands.deleteRange({ from: first, to: first + 5 });
    expectFullyHighlighted(instance);

    // Split the python block, then join it back.
    const second = codeStart(instance, 1);
    instance
      .chain()
      .setTextSelection(second + 9)
      .splitBlock()
      .run();
    expectFullyHighlighted(instance);
    instance.commands.joinBackward();
    expectFullyHighlighted(instance);

    // Delete a whole code block.
    const block = codeStart(instance, 0) - 1;
    const size = instance.state.doc.nodeAt(block)?.nodeSize ?? 0;
    instance.commands.deleteRange({ from: block, to: block + size });
    expectFullyHighlighted(instance);
  });

  it("highlights pasted code blocks and language changes", () => {
    const instance = setup();
    instance.commands.insertContentAt(instance.state.doc.content.size, [
      code("css", "a { color: red; }"),
      paragraph("tail"),
    ]);
    expectFullyHighlighted(instance);

    instance.commands.setTextSelection(codeStart(instance, 0));
    instance.commands.updateAttributes("codeBlock", { language: "python" });
    expect(
      instance.state.doc.nodeAt(codeStart(instance, 0) - 1)?.attrs.language,
    ).toBe("python");
    expectFullyHighlighted(instance);
  });

  it("is correct after undo, redo and whole-document replacement", () => {
    const instance = setup();
    instance.commands.insertContentAt(codeStart(instance, 0), "let b = 2;\n");
    instance.commands.undo();
    expectFullyHighlighted(instance);
    instance.commands.redo();
    expectFullyHighlighted(instance);

    instance.commands.setContent({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "New" }],
        },
        code("ts", "type A = { b: string };"),
      ],
    });
    expectFullyHighlighted(instance);
  });

  it("reuses tokens for an unchanged block that a change spans", () => {
    const instance = setup();
    // One step that rewrites both code blocks' surroundings: the replaced
    // range covers the python block, but its node is reused as is.
    const { state } = instance;
    const python = codeStart(instance, 1) - 1;
    const node = state.doc.nodeAt(python);
    if (!node) throw new Error("missing code block");
    const tr = state.tr.replaceWith(python - 9, state.doc.content.size, [
      state.schema.nodes.paragraph.create(null, state.schema.text("b")),
      node,
      state.schema.nodes.paragraph.create(null, state.schema.text("a")),
    ]);
    instance.view.dispatch(tr);
    expect(countingLowlight.highlight).not.toHaveBeenCalled();
    expectFullyHighlighted(instance);
  });
});
