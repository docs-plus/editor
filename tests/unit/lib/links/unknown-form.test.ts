import { afterEach, describe, expect, it, mock } from "bun:test";

import { Editor, getSchema, type JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { buildDocumentEditorExtensions } from "@/components/document-editor/document-editor-config";
import { docHref } from "@/lib/links/doc-link";
import { extractLinks } from "@/lib/links/extract-links";
import { LINK_STATE_LABEL } from "@/lib/links/link-copy";
import { createLinkHost, type LinkHostHandle } from "@/lib/links/link-host";
import type { LinkHost } from "@/lib/links/link-host-types";
import type { LinkIndexSnapshot } from "@/lib/links/resolve";

/**
 * A link written by a newer TinyDocy (a `tinydocy:` href this version can't
 * parse) is never modified (search-linking §4.6): `isAllowedUri` refuses
 * new writes of it, but loading the document and editing around it keep it
 * byte for byte, on the app's real editor with a link host.
 */
/** A later form of the grammar (`classifyDocLink` → "later"). */
const FUTURE = "tinydocy:folder/future-form";
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
    // Both don't open, so the state prefixes the link's accessible name.
    const icons = [
      ...editor.view.dom.querySelectorAll<HTMLElement>(".doc-link-icon"),
    ].map((icon) => ({
      state: icon.dataset.linkState,
      role: icon.getAttribute("role"),
      label: icon.getAttribute("aria-label"),
      hidden: icon.getAttribute("aria-hidden"),
    }));
    expect(icons).toEqual([
      {
        state: "unknown_form",
        role: "img",
        label: LINK_STATE_LABEL.unknown_form ?? null,
        hidden: null,
      },
      {
        state: "not_available",
        role: "img",
        label: LINK_STATE_LABEL.not_available ?? null,
        hidden: null,
      },
    ]);
  });

  it("refresh redraws state and aria in the live editor, without a re-parse", async () => {
    const schema = getSchema(extensionsFor(new Y.Doc(), {} as Awareness));
    const ydoc = prosemirrorJSONToYDoc(schema, CONTENT, "default");
    const entry = {
      id: "doc-a",
      title: "Q4 budget",
      createdAt: 0,
      linkKey: KEY,
    };
    let snapshot: LinkIndexSnapshot = { items: [] };
    handle = createLinkHost({
      getSnapshot: () => snapshot,
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
    const view = editor.view;
    const icon = () =>
      view.dom.querySelector<HTMLElement>(
        `a[href="${docHref(KEY)}"] .doc-link-icon`,
      );
    const first = icon();
    const aria = () => ({
      state: icon()?.dataset.linkState,
      role: icon()?.getAttribute("role") ?? null,
      label: icon()?.getAttribute("aria-label") ?? null,
      hidden: icon()?.getAttribute("aria-hidden") ?? null,
    });
    expect(aria()).toEqual({
      state: "not_available",
      role: "img",
      label: LINK_STATE_LABEL.not_available ?? null,
      hidden: null,
    });

    snapshot = { items: [entry] };
    handle.refreshIcons(view.dom);
    expect(icon()).toBe(first);
    expect(aria()).toEqual({
      state: "resolves",
      role: null,
      label: null,
      hidden: "true",
    });
    expect(icon()?.querySelector("path[d='M16 13H8']")).not.toBeNull();

    snapshot = { items: [], trashed: [entry] };
    handle.refreshIcons(view.dom);
    expect(icon()).toBe(first);
    expect(aria()).toEqual({
      state: "in_trash",
      role: "img",
      label: LINK_STATE_LABEL.in_trash ?? null,
      hidden: null,
    });
    expect(icon()?.querySelector("path[d='M9 15h6']")).not.toBeNull();

    // ProseMirror's observer ignores changes inside the icon: no re-parse.
    const transactions = mock(() => {});
    editor.on("transaction", transactions);
    await new Promise((resolve) => setTimeout(resolve, 20));
    view.dispatch(editor.state.tr.setMeta("probe", true));
    expect(transactions).toHaveBeenCalledTimes(1);
    expect(icon()).toBe(first);
    expect(hrefsIn(ydoc)).toEqual([FUTURE, docHref(KEY)]);
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
