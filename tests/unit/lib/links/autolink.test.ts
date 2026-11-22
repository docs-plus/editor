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
 * Typed `tinydocy:` text never autolinks (search-linking §4.2 as amended by
 * the linking review): document links are made by the picker, and pasting
 * one arrives as HTML in LK2. So the host registers no linkify scheme at
 * all; the extension's read and write gates take document links through
 * `isAllowedUri` alone. Each case starts from a fresh linkify, as a page
 * does.
 */
const KEY = "0123456789abcdef0123456789abcdef";
const editors: Editor[] = [];
const handles: LinkHostHandle[] = [];

afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
  for (const handle of handles.splice(0)) handle.dispose();
});

/** linkify's live state: `reset()` returns it, and later calls mutate it. */
interface LinkifyState {
  customSchemes: [scheme: string, optionalSlashes: boolean][];
}

function freshLinkify(): LinkifyState {
  return resetLinkify() as unknown as LinkifyState;
}

function makeHost(): LinkHostHandle {
  const handle = createLinkHost({
    getSnapshot: () => ({ items: [], folders: [] }),
    openDocument() {},
    goToHeadingHere: () => false,
    openExternal() {},
    announce() {},
  });
  handles.push(handle);
  return handle;
}

function makeEditor(host: LinkHostHandle["host"]): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [Document, Paragraph, Text, Hyperlink.configure({ ...host })],
  });
  editors.push(editor);
  return editor;
}

/** Tiptap runs `onCreate` (where the extension registers schemes) on a timer. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

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

const tinydocyRegistrations = (state: LinkifyState) =>
  state.customSchemes.filter(([scheme]) => scheme === "tinydocy").length;

describe("document links and linkify", () => {
  it("the host hands the extension no protocols", () => {
    expect(makeHost().host.protocols).toBeUndefined();
  });

  it("registers tinydocy at most once across two editors and a remount", async () => {
    const linkify = freshLinkify();
    const handle = makeHost();
    makeEditor(handle.host);
    makeEditor(handle.host);
    await settle();
    editors.shift()?.destroy();
    makeEditor(handle.host);
    await settle();
    expect(tinydocyRegistrations(linkify)).toBeLessThanOrEqual(1);
  });

  it("never autolinks typed tinydocy: text, while web URLs still link", async () => {
    freshLinkify();
    const editor = makeEditor(makeHost().host);
    await settle();
    type(editor, `See ${docHref(KEY)} and tinydocy:doc/NOT-A-KEY `);
    expect(hrefs(editor)).toEqual([]);
    type(editor, "then https://example.com ");
    expect(hrefs(editor)).toEqual(["https://example.com"]);
  });
});
