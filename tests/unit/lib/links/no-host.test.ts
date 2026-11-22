import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { Editor, getSchema, type JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { buildDocumentEditorExtensions } from "@/components/document-editor/document-editor-config";

/**
 * With no link host (the web sandbox today), a `tinydocy:` link is never
 * opened, whether it arrived from Yjs or a paste: the Hyperlink extension's
 * default would hand it to `window.open`, and so to whatever app the OS has
 * registered for the scheme (search-linking §4.4, "Opened in the public
 * sandbox"). Web links still open as before.
 */
const KEY = "0123456789abcdef0123456789abcdef";
const mac = /mac/i.test(navigator.userAgent);

const extensionsFor = (ydoc: Y.Doc, awareness: Awareness) =>
  buildDocumentEditorExtensions({
    documentId: "no-host",
    ydoc,
    awareness,
    getProvider: () => null,
    canWrite: () => true,
    onFoldChange() {},
    onFilterChange() {},
    onTocUpdate() {},
  });

const linked = (text: string, href: string): JSONContent => ({
  type: "text",
  text,
  marks: [{ type: "hyperlink", attrs: { href } }],
});

let editor: Editor | undefined;
let element: HTMLElement | undefined;
afterEach(() => {
  editor?.destroy();
  element?.remove();
  editor = undefined;
});

async function openOn(content: JSONContent[]): Promise<Editor> {
  const schema = getSchema(extensionsFor(new Y.Doc(), {} as Awareness));
  const ydoc = prosemirrorJSONToYDoc(
    schema,
    { type: "doc", content },
    "default",
  );
  element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({
    element,
    extensions: extensionsFor(ydoc, new Awareness(ydoc)),
  });
  await new Promise((resolve) => setTimeout(resolve, 30));
  return editor;
}

/** Mod-click, the extension's open gesture while editing. */
function modClick(anchor: Element | null) {
  for (const type of ["mousedown", "mouseup", "click"]) {
    anchor?.dispatchEvent(
      new MouseEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        metaKey: mac,
        ctrlKey: !mac,
      }),
    );
  }
}

const title = {
  type: "heading",
  attrs: { level: 1 },
  content: [{ type: "text", text: "T" }],
};

describe("document links with no host", () => {
  it("never opens a tinydocy: link that came from Yjs", async () => {
    const open = spyOn(window, "open").mockImplementation(() => null);
    try {
      const view = await openOn([
        title,
        {
          type: "paragraph",
          content: [
            linked("doc", `tinydocy:doc/${KEY}`),
            { type: "text", text: " " },
            linked("odd", " TINYDOCY:here#x"),
            { type: "text", text: " " },
            linked("web", "https://example.com/"),
          ],
        },
      ]);
      const anchors = view.view.dom.querySelectorAll("a");
      modClick(anchors[0]);
      modClick(anchors[1]);
      expect(open).not.toHaveBeenCalled();
      // Web links still open, as on main.
      modClick(anchors[2]);
      expect(open.mock.calls.map((call) => call[0])).toEqual([
        "https://example.com/",
      ]);
    } finally {
      open.mockRestore();
    }
  });

  it("never opens a pasted tinydocy: link", async () => {
    const open = spyOn(window, "open").mockImplementation(() => null);
    try {
      const view = await openOn([title, { type: "paragraph" }]);
      view.commands.setTextSelection(view.state.doc.content.size - 1);
      view.commands.insertContent(
        `<a href="tinydocy:doc/${KEY}">pasted</a> <a href="https://example.com/">web</a>`,
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      const anchors = [...view.view.dom.querySelectorAll("a")];
      modClick(anchors.find((a) => a.textContent === "pasted") ?? null);
      expect(open).not.toHaveBeenCalled();
      // The sandbox still writes no new ones by command.
      view.commands.selectAll();
      expect(view.commands.setHyperlink({ href: `tinydocy:doc/${KEY}` })).toBe(
        false,
      );
      // The default isAllowedUri adds to the extension's own safety gate,
      // which still runs first: dangerous schemes stay refused.
      for (const href of ["javascript:alert(1)", " data:text/html,x"]) {
        expect(view.commands.setHyperlink({ href })).toBe(false);
      }
      expect(view.commands.setHyperlink({ href: "https://example.com/" })).toBe(
        true,
      );
    } finally {
      open.mockRestore();
    }
  });
});
