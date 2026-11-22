import { afterEach, describe, expect, it } from "bun:test";

import { Editor, getSchema, type JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { buildDocumentEditorExtensions } from "@/components/document-editor/document-editor-config";
import { docHref } from "@/lib/links/doc-link";
import { extractLinks } from "@/lib/links/extract-links";
import { createLinkHost, type LinkHostHandle } from "@/lib/links/link-host";
import type { LinkHost } from "@/lib/links/link-host-types";

/**
 * A link written by a newer TinyDocy (a `tinydocy:` href this version can't
 * parse) is never modified (search-linking §4.6): `isAllowedUri` refuses
 * new writes of it, but loading the document and editing around it keep it
 * byte for byte, on the app's real editor with a link host.
 */
const FUTURE = "tinydocy://local/doc/future-form";
const KEY = "0123456789abcdef0123456789abcdef";

const extensionsFor = (
  ydoc: Y.Doc,
  awareness: Awareness,
  linkHost?: LinkHost,
) =>
  buildDocumentEditorExtensions({
    documentId: "unknown-form",
    ydoc,
    awareness,
    getProvider: () => null,
    canWrite: () => true,
    onFoldChange() {},
    onFilterChange() {},
    onTocUpdate() {},
    linkHost,
  });

const link = (text: string, href: string): JSONContent => ({
  type: "text",
  text,
  marks: [{ type: "hyperlink", attrs: { href } }],
});

const CONTENT: JSONContent = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: {
        level: 1,
        "data-toc-id": "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b",
      },
      content: [{ type: "text", text: "Title" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "See " },
        link("the future", FUTURE),
        { type: "text", text: " and " },
        link("the plan", docHref(KEY)),
      ],
    },
    { type: "paragraph", content: [{ type: "text", text: "Edit here" }] },
  ],
};

function hrefsIn(ydoc: Y.Doc): string[] {
  const hrefs: string[] = [];
  const walk = (node: Y.XmlElement | Y.XmlFragment) => {
    for (const child of node.toArray()) {
      if (child instanceof Y.XmlText) {
        for (const item of child.toDelta() as {
          attributes?: { hyperlink?: { href?: string } };
        }[]) {
          const href = item.attributes?.hyperlink?.href;
          if (href) hrefs.push(href);
        }
      } else if (child instanceof Y.XmlElement) walk(child);
    }
  };
  walk(ydoc.getXmlFragment("default"));
  return hrefs;
}

let editor: Editor | undefined;
let handle: LinkHostHandle | undefined;
afterEach(() => {
  editor?.destroy();
  handle?.dispose();
  editor = undefined;
  handle = undefined;
});

describe("unknown link forms", () => {
  it("survive loading and edits around them", async () => {
    const schema = getSchema(extensionsFor(new Y.Doc(), {} as Awareness));
    const ydoc = prosemirrorJSONToYDoc(schema, CONTENT, "default");
    expect(hrefsIn(ydoc)).toEqual([FUTURE, docHref(KEY)]);

    handle = createLinkHost({
      getSnapshot: () => ({ items: [], folders: [] }),
      openDocument() {},
      goToHeadingHere: () => false,
      openExternal() {},
      announce() {},
    });
    editor = new Editor({
      element: document.createElement("div"),
      extensions: extensionsFor(ydoc, new Awareness(ydoc), handle.host),
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Typing elsewhere in the document.
    let editAt = 0;
    editor.state.doc.descendants((node, pos) => {
      if (node.isText && node.text === "Edit here") editAt = pos;
    });
    editor.commands.insertContentAt(editAt, "More. ");
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(hrefsIn(ydoc)).toEqual([FUTURE, docHref(KEY)]);
    expect(
      extractLinks(ydoc.getXmlFragment("default")).map((r) => r.key),
    ).toEqual([KEY]);
    // It still draws, as a link this version can't open.
    const icons = [
      ...editor.view.dom.querySelectorAll<HTMLElement>(".doc-link-icon"),
    ].map((icon) => icon.dataset.linkState);
    expect(icons).toEqual(["unknown_form", "not_in_library"]);
  });

  it("can't be written anew", () => {
    handle = createLinkHost({
      getSnapshot: () => ({ items: [], folders: [] }),
      openDocument() {},
      goToHeadingHere: () => false,
      openExternal() {},
      announce() {},
    });
    const ydoc = new Y.Doc();
    editor = new Editor({
      element: document.createElement("div"),
      extensions: extensionsFor(ydoc, new Awareness(ydoc), handle.host),
    });
    editor.commands.setContent(CONTENT);
    editor.commands.selectAll();
    expect(editor.commands.setHyperlink({ href: FUTURE })).toBe(false);
    expect(editor.commands.setHyperlink({ href: docHref(KEY) })).toBe(true);
  });
});
