import { afterEach, expect, test } from "bun:test";
import { join } from "node:path";

import { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";

import { tiptapStyleText } from "@/desktop/build/tiptap-style";

const ROOT = join(import.meta.dir, "../../../..");
let editor: Editor | null = null;

afterEach(() => {
  editor?.destroy();
  editor = null;
  document.querySelector("style[data-tiptap-style]")?.remove();
});

test("the build hashes exactly the stylesheet Tiptap injects", () => {
  editor = new Editor({
    element: document.createElement("div"),
    extensions: [StarterKit],
  });
  const injected = document.querySelector("style[data-tiptap-style]");
  expect(injected).not.toBeNull();
  expect(tiptapStyleText(ROOT)).toBe(injected?.textContent ?? "");
});
