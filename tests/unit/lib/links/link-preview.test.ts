import { afterEach, describe, expect, it, mock } from "bun:test";

import { Hyperlink } from "@docs.plus/extension-hyperlink";
import { Editor } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";

import { createLinkPopovers, docLinkPreview } from "@/lib/links/link-preview";
import type { LinkState } from "@/lib/links/resolve";

/**
 * The document-link preview (linking review decision 4): title, path or
 * state, [Open] [Copy Link] [Remove Link]; never the href or the key.
 */
const KEY = "0123456789abcdef0123456789abcdef";
const HREF = `tinydocy:doc/${KEY}`;
const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

function makeEditor(editable = true): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    editable,
    extensions: [Document, Paragraph, Text, Heading, Hyperlink],
    content: "<p><a href='tinydocy:doc/x'>link</a></p>",
  });
  editors.push(editor);
  return editor;
}

const resolves: LinkState = {
  state: "resolves",
  docId: "d-budget",
  title: "Q4 budget",
  path: ["Work"],
  tocId: null,
};

function card(state: LinkState | null, editable = true) {
  const follow = mock(() => {});
  const node = docLinkPreview(
    { editor: makeEditor(editable), attrs: { href: HREF } as never },
    { resolve: () => state, follow },
  );
  const labels = [...node.querySelectorAll("button")].map((b) => b.textContent);
  return { node, follow, labels };
}

const leaks = (node: HTMLElement) =>
  /tinydocy:|[0-9a-f]{32}/.test(node.outerHTML.replace(/class="[^"]*"/g, ""));

describe("docLinkPreview", () => {
  it("shows the title and path, never the href or key", () => {
    const { node, labels } = card(resolves);
    expect(node.textContent).toContain("Q4 budget");
    expect(node.textContent).toContain("Library › Work");
    expect(leaks(node)).toBe(false);
    expect(labels).toEqual(["Open", "Copy Link", "Remove Link"]);
  });

  it("shows the state for a link that doesn't open, with no Open", () => {
    const { node, labels } = card({ state: "not_in_library" });
    expect(node.textContent).toContain("isn't in your library");
    expect(node.dataset.linkState).toBe("not_available");
    expect(leaks(node)).toBe(false);
    expect(labels).toEqual(["Copy Link", "Remove Link"]);
  });

  it("offers no Remove Link when the document is read-only", () => {
    expect(card(resolves, false).labels).toEqual(["Open", "Copy Link"]);
  });

  it("Open follows in this tab", () => {
    const { node, follow } = card(resolves);
    node.querySelector("button")?.click();
    expect(follow).toHaveBeenCalledWith(HREF, false);
  });
});

describe("createLinkPopovers", () => {
  it("keeps the package's preview for web links", () => {
    const popovers = createLinkPopovers({ resolve: () => null, follow() {} });
    const editor = makeEditor();
    const link = document.createElement("a");
    link.href = "https://example.com/";
    const node = popovers.previewHyperlink?.({
      editor,
      link,
      nodePos: 1,
      attrs: { href: "https://example.com/" } as never,
    });
    expect(node?.classList.contains("doc-link-preview")).toBe(false);
    expect(node?.textContent).toContain("https://example.com/");
  });

  it("uses the document card for preview and edit of document links", () => {
    const popovers = createLinkPopovers({
      resolve: () => resolves,
      follow() {},
    });
    const editor = makeEditor();
    const link = document.createElement("a");
    link.setAttribute("href", HREF);
    const preview = popovers.previewHyperlink?.({
      editor,
      link,
      nodePos: 1,
      attrs: { href: HREF } as never,
    });
    const edit = popovers.editHyperlink?.({ editor, link });
    for (const node of [preview, edit]) {
      expect(node?.classList.contains("doc-link-preview")).toBe(true);
      expect(node && leaks(node)).toBe(false);
    }
  });
});
