import { afterEach, describe, expect, it } from "bun:test";

import { Mermaid } from "@docs.plus/extension-mermaid";
import { Editor, type Extension, type JSONContent } from "@tiptap/core";
import { Markdown } from "@tiptap/markdown";
import { StarterKit } from "@tiptap/starter-kit";

import { SafeCodeBlock } from "@/components/document-editor/safe-code-block";
import { sanitizeCodeLanguage } from "@/lib/code-language";
import { lowlight } from "@/lib/lowlight";

import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";

const EXTENSIONS = [
  ...DEFAULT_EXTENSIONS.filter((extension) => extension.name !== "codeBlock"),
  SafeCodeBlock.configure({ lowlight }),
  Markdown,
] as Extension[];

function docWithCode(language: string, text = "const a = 1;"): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "T" }],
      },
      {
        type: "codeBlock",
        attrs: { language },
        content: [{ type: "text", text }],
      },
    ],
  };
}

let editor: Editor | null = null;

function render(language: string, extensions = EXTENSIONS) {
  editor = createTestEditor({ content: docWithCode(language), extensions });
  return editor;
}

/** Every class token rendered inside the code block, decorations included. */
function classTokensInCodeBlock(instance: Editor): string[] {
  const pre = instance.view.dom.querySelector("pre");
  if (!pre) throw new Error("code block not rendered");
  return [pre, ...pre.querySelectorAll("*")].flatMap((element) => [
    ...element.classList,
  ]);
}

afterEach(() => {
  editor?.destroy();
  editor = null;
});

describe("sanitizeCodeLanguage", () => {
  it.each([
    "typescript",
    "c++",
    "c#",
    "objective-c",
    "vb.net",
    "mermaid",
    "x_1",
  ])("accepts %s", (value) => {
    expect(sanitizeCodeLanguage(value)).toBe(value);
  });

  it.each([
    "x fixed inset-0 z-50",
    'ts" onclick="alert(1)',
    "ts><img src=x>",
    "a\nb",
    "",
    "a".repeat(41),
    null,
    undefined,
    42,
  ])("rejects %j", (value) => {
    expect(sanitizeCodeLanguage(value)).toBeNull();
  });
});

describe("SafeCodeBlock rendering", () => {
  it("renders a safe language as language-<name>", () => {
    const instance = render("typescript");
    const code = instance.view.dom.querySelector("pre > code");
    expect(code?.className).toBe("language-typescript");
    expect(instance.getHTML()).toContain('<code class="language-typescript">');
  });

  it.each([
    "x fixed inset-0 z-50",
    'ts" onclick="alert(1)',
    "ts><img src=x onerror=alert(1)>",
  ])(
    "drops the class for %j in the editor view and HTML export",
    (language) => {
      const instance = render(language);
      const code = instance.view.dom.querySelector("pre > code");
      expect(code?.hasAttribute("class")).toBe(false);
      for (const token of ["fixed", "inset-0", "z-50", "onclick", "img"]) {
        expect(classTokensInCodeBlock(instance)).not.toContain(token);
      }
      expect(instance.view.dom.querySelector("pre img")).toBeNull();
      const html = instance.getHTML();
      expect(html).toContain("<pre><code>");
      expect(html).not.toContain("fixed");
      expect(html).not.toContain("onclick");
      // The stored attribute is untouched; only rendering is gated.
      expect(instance.getJSON().content?.[1].attrs?.language).toBe(language);
    },
  );

  it("only emits highlighter classes as decorations", () => {
    const instance = render("x fixed inset-0 z-50");
    const tokens = classTokensInCodeBlock(instance);
    expect(tokens.every((token) => token.startsWith("hljs"))).toBe(true);
  });
});

describe("SafeCodeBlock parsing", () => {
  it("keeps a safe language class from pasted HTML", () => {
    const instance = render("typescript");
    instance.commands.setContent(
      '<h1>T</h1><pre><code class="language-python">x = 1</code></pre>',
    );
    expect(instance.getJSON().content?.[1].attrs?.language).toBe("python");
  });

  it("drops an unsafe language class from pasted HTML", () => {
    const instance = render("typescript");
    instance.commands.setContent(
      '<h1>T</h1><pre><code class="language-x&quot;&gt; fixed">x</code></pre>',
    );
    expect(instance.getJSON().content?.[1].attrs?.language).toBeNull();
  });

  it("takes only the first word of a Markdown fence info string", () => {
    const instance = render("typescript");
    instance.commands.setContent(
      "# T\n\n```ts fixed inset-0 z-50\nconst a = 1;\n```\n",
      { contentType: "markdown" },
    );
    const block = instance.getJSON().content?.[1];
    expect(block?.type).toBe("codeBlock");
    expect(block?.attrs?.language).toBe("ts");
  });

  it("drops an unsafe Markdown language", () => {
    const instance = render("typescript");
    instance.commands.setContent('# T\n\n```"><x\nconst a = 1;\n```\n', {
      contentType: "markdown",
    });
    expect(instance.getJSON().content?.[1].attrs?.language).toBeNull();
  });

  it("never exports an unsafe language to Markdown", () => {
    // Minimal schema: Markdown export is code block behaviour, not doc shape.
    editor = new Editor({
      element: document.createElement("div"),
      extensions: [
        StarterKit.configure({ codeBlock: false }),
        SafeCodeBlock.configure({ lowlight }),
        Markdown,
      ],
      content: {
        type: "doc",
        content: [
          {
            type: "codeBlock",
            attrs: { language: "js\n# injected" },
            content: [{ type: "text", text: "a" }],
          },
          {
            type: "codeBlock",
            attrs: { language: "ts" },
            content: [{ type: "text", text: "b" }],
          },
        ],
      },
    });
    expect(editor.getMarkdown()).toBe("```\na\n```\n\n```ts\nb\n```");
  });
});

describe("SafeCodeBlock with Mermaid", () => {
  it("still mounts the Mermaid node view for language 'mermaid'", () => {
    const instance = render("mermaid", [...EXTENSIONS, Mermaid] as Extension[]);
    expect(instance.view.dom.querySelector(".mermaid-diagram")).not.toBeNull();
    expect(
      instance.view.dom.querySelector(".mermaid-diagram code")?.className,
    ).toBe("language-mermaid");
  });
});
