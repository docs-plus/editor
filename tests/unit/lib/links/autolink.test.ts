import { afterEach, describe, expect, it } from "bun:test";

import { Hyperlink } from "@docs.plus/extension-hyperlink";
import { Editor } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { reset as resetLinkify } from "linkifyjs";

import { docHref } from "@/lib/links/doc-link";
import { createLinkHost, type LinkHostHandle } from "@/lib/links/link-host";

/**
 * linkifyjs takes a custom scheme only before its first scan; the
 * extension registers `protocols` in `onCreate`, on a timer. So
 * `createLinkHost` registers the scheme itself: a host made at app start,
 * before the first editor, gets document links autolinked like any URL
 * (search-linking §4.2). Each case starts from a fresh linkify, as a page
 * does.
 */
const KEY = "0123456789abcdef0123456789abcdef";
const editors: Editor[] = [];
let handle: LinkHostHandle | undefined;

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  handle?.dispose();
});

function makeEditor(host?: LinkHostHandle["host"]): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [
      Document,
      Paragraph,
      Text,
      Hyperlink.configure({ ...(host ?? {}) }),
    ],
  });
  editors.push(editor);
  return editor;
}

function hrefs(editor: Editor): string[] {
  const out: string[] = [];
  editor.state.doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === "hyperlink") out.push(mark.attrs.href as string);
    }
  });
  return out;
}

function type(editor: Editor, text: string) {
  for (const char of text)
    editor.view.dispatch(editor.state.tr.insertText(char));
}

describe("autolinking document links", () => {
  it("links a typed tinydocy: href, even before the editor's onCreate", () => {
    resetLinkify();
    handle = createLinkHost({
      getSnapshot: () => ({ items: [], folders: [] }),
      openDocument() {},
      goToHeadingHere: () => false,
      openExternal() {},
      announce() {},
    });
    const editor = makeEditor(handle.host);
    const href = docHref(KEY);
    type(editor, `See ${href} and https://example.com `);
    expect(hrefs(editor)).toEqual([href, "https://example.com"]);
  });

  it("autolinks only document links that parse", () => {
    resetLinkify();
    handle = createLinkHost({
      getSnapshot: () => ({ items: [], folders: [] }),
      openDocument() {},
      goToHeadingHere: () => false,
      openExternal() {},
      announce() {},
    });
    const editor = makeEditor(handle.host);
    type(editor, "See tinydocy:doc/NOT-A-KEY here ");
    expect(hrefs(editor)).toEqual([]);
  });
});
