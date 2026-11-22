/**
 * The web editor links only to `https:`, `http:` and `mailto:`. The Hyperlink
 * extension's own check is a denylist (`javascript:`, `data:`, …), so without
 * this an `ms-msdt:` or `search-ms:` link pasted in or delivered through Yjs
 * stayed a live `<a href>` that Mod-click handed to the OS.
 */
import { afterEach, describe, expect, it, spyOn } from "bun:test";

import { Editor, getSchema, isMacOS, type JSONContent } from "@tiptap/core";
import { prosemirrorJSONToYDoc } from "@tiptap/y-tiptap";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import {
  buildDocumentEditorExtensions,
  isWebLink,
} from "@/components/document-editor/document-editor-config";

const DOC_KEY = "0123456789abcdef0123456789abcdef";

const RISKY = [
  "ms-msdt:/id PCWDiagnostic /skip force",
  "search-ms:query=x&crumb=location:\\\\evil\\share",
  "smb://evil/share",
  "vscode://evil.extension/run",
  `tinydocy:doc/${DOC_KEY}`,
  ` tinydocy:doc/${DOC_KEY}`,
];

const ALLOWED = ["https://example.com/", "http://example.com/", "mailto:a@b.c"];

const text = (value: string, href?: string): JSONContent => ({
  type: "text",
  text: value,
  ...(href ? { marks: [{ type: "hyperlink", attrs: { href } }] } : {}),
});

const extensionsFor = (ydoc: Y.Doc, awareness: Awareness) =>
  buildDocumentEditorExtensions({
    documentId: "link-allowlist",
    ydoc,
    awareness,
    getProvider: () => null,
    canWrite: () => true,
    onFoldChange() {},
    onFilterChange() {},
    onTocUpdate() {},
  });

/** A Y.Doc holding `content`, as a collaborator's update would deliver it. */
function seededDoc(content: JSONContent): Y.Doc {
  const schema = getSchema(extensionsFor(new Y.Doc(), {} as Awareness));
  return prosemirrorJSONToYDoc(schema, content, "default");
}

const docWith = (...paragraphs: JSONContent[][]): JSONContent => ({
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [text("Links")] },
    ...paragraphs.map((content) => ({ type: "paragraph", content })),
  ],
});

let editor: Editor | undefined;
let awareness: Awareness | undefined;
afterEach(() => {
  editor?.destroy();
  awareness?.destroy();
  editor = undefined;
  awareness = undefined;
});

/** Opens the app's editor on `content` and waits for `create`. */
async function open(content: JSONContent = docWith([text("Body")])) {
  const ydoc = seededDoc(content);
  awareness = new Awareness(ydoc);
  const element = document.createElement("div");
  document.body.append(element);
  editor = new Editor({ element, extensions: extensionsFor(ydoc, awareness) });
  await new Promise((resolve) => setTimeout(resolve, 30));
  return editor;
}

/** Selects the text of the last paragraph, then runs `setHyperlink`. */
function setLink(target: Editor, href: string): boolean {
  const end = target.state.doc.content.size - 1;
  const start = end - (target.state.doc.lastChild?.content.size ?? 0);
  target.commands.setTextSelection({ from: start, to: end });
  return target.commands.setHyperlink({ href });
}

/** Every hyperlink mark's href in the document, in order. */
function hrefs(target: Editor): unknown[] {
  const found: unknown[] = [];
  target.state.doc.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === "hyperlink") found.push(mark.attrs.href);
    }
  });
  return found;
}

/** A primary-button Mod-click on `anchor`, as a browser fires it. */
function modClick(anchor: Element) {
  const init = {
    bubbles: true,
    cancelable: true,
    button: 0,
    detail: 1,
    metaKey: isMacOS(),
    ctrlKey: !isMacOS(),
  };
  for (const type of ["mousedown", "mouseup", "click"]) {
    anchor.dispatchEvent(new MouseEvent(type, init));
  }
}

const forRead = (target: Editor, href: string) =>
  (
    target.storage as unknown as {
      hyperlink: {
        context: {
          urls: { forRead: (href: string) => { navigable: boolean } };
        } | null;
      };
    }
  ).hyperlink.context?.urls.forRead(href).navigable;

describe("isWebLink", () => {
  it("allows the three schemes in any case, after leading whitespace", () => {
    for (const href of [...ALLOWED, "HTTPS://example.com/", " \thttp://x/"]) {
      expect(isWebLink(href)).toBe(true);
    }
  });

  it("refuses a scheme split by whitespace or led by a control", () => {
    // Browsers would read these as https; refusing them is the safe side.
    for (const href of ["ht\ttps://x/", "https\n://x/", "\u0001https://x/"]) {
      expect(isWebLink(href)).toBe(false);
    }
  });
});

describe("link allowlist: commands", () => {
  it.each(RISKY)("setHyperlink refuses %p", async (href) => {
    const target = await open();
    expect(setLink(target, href)).toBe(false);
    expect(hrefs(target)).toEqual([]);
  });

  it.each(ALLOWED)("setHyperlink accepts %p", async (href) => {
    const target = await open();
    expect(setLink(target, href)).toBe(true);
    expect(hrefs(target)).toEqual([href]);
  });
});

describe("link allowlist: links that arrive through Yjs", () => {
  it("renders a refused link with no href and never opens it", async () => {
    const target = await open(
      docWith(...RISKY.map((href, i) => [text(`risky${i}`, href)]), [
        text("web", "https://example.com/"),
      ]),
    );
    const anchors = [...target.view.dom.querySelectorAll("a")];
    expect(anchors).toHaveLength(RISKY.length + 1);

    const open_ = spyOn(window, "open").mockImplementation(() => null);
    try {
      for (const anchor of anchors.slice(0, RISKY.length)) {
        expect(anchor.hasAttribute("href")).toBe(false);
        modClick(anchor);
      }
      expect(open_).not.toHaveBeenCalled();

      // Control: the https link renders and opens as before.
      const web = anchors[RISKY.length];
      expect(web.getAttribute("href")).toBe("https://example.com/");
      modClick(web);
      expect(open_).toHaveBeenCalledTimes(1);
      expect(open_.mock.calls[0]?.[0]).toBe("https://example.com/");
    } finally {
      open_.mockRestore();
    }
  });

  it("the read gate refuses every scheme off the allowlist", async () => {
    const target = await open();
    expect(forRead(target, "ms-msdt:x")).toBe(false);
    expect(forRead(target, `tinydocy:doc/${DOC_KEY}`)).toBe(false);
    expect(forRead(target, "https://example.com/")).toBe(true);
    expect(forRead(target, "MAILTO:a@b.c")).toBe(true);
  });
});

describe("link allowlist: paste", () => {
  it("drops every refused link mark and keeps its text", async () => {
    const target = await open();
    const risky = RISKY.map(
      (href, i) => `<a href="${href.replaceAll('"', "&quot;")}">risky${i}</a>`,
    ).join(" ");
    target.commands.insertContent(
      `<p>${risky} <a href="https://example.com/">web</a></p>`,
    );
    expect(hrefs(target)).toEqual(["https://example.com/"]);
    const body = target.state.doc.textContent;
    for (let i = 0; i < RISKY.length; i++) expect(body).toContain(`risky${i}`);
  });

  it("keeps a pasted https link but not its title", async () => {
    const target = await open();
    target.commands.insertContent(
      '<p><a href="https://example.com/" title="Your bank: click to verify">bank</a></p>',
    );
    const marks: Record<string, unknown>[] = [];
    target.state.doc.descendants((node) => {
      for (const mark of node.marks) {
        if (mark.type.name === "hyperlink") marks.push(mark.attrs);
      }
    });
    expect(marks).toHaveLength(1);
    expect(marks[0]?.href).toBe("https://example.com/");
    expect(marks[0]?.title).toBeNull();
    const anchor = target.view.dom.querySelector("a");
    expect(anchor?.getAttribute("href")).toBe("https://example.com/");
    expect(anchor?.hasAttribute("title")).toBe(false);
  });

  it("still renders a title the document already holds", async () => {
    const target = await open(
      docWith([
        {
          type: "text",
          text: "titled",
          marks: [
            {
              type: "hyperlink",
              attrs: { href: "https://example.com/", title: "Example" },
            },
          ],
        },
      ]),
    );
    expect(target.view.dom.querySelector("a")?.getAttribute("title")).toBe(
      "Example",
    );
  });
});

/**
 * What the allowlist stops that worked before. Each is listed in the PR and
 * the CHANGELOG; none is used by the app itself.
 */
describe("link allowlist: refused hrefs that used to link", () => {
  it.each([
    ["a bare E.164 phone (tel:)", "+14155550123"],
    ["tel:", "tel:+14155550123"],
    ["sms:", "sms:+14155550123"],
    ["an app scheme from the extension's catalog", "whatsapp://send?text=hi"],
    ["ftp:", "ftp://example.com/file"],
    ["a fragment", "#intro"],
    ["an absolute path", "/about"],
    ["a dot-relative path", "./notes"],
    ["a protocol-relative URL", "//example.com/"],
  ])("%s", async (_, href) => {
    const target = await open();
    expect(setLink(target, href)).toBe(false);
  });

  /** Types `word` at the end of the body, then the space that autolinks it. */
  async function typeWord(word: string) {
    const target = await open();
    target.commands.setTextSelection(target.state.doc.content.size - 1);
    target.commands.insertContent(` ${word}`);
    target.commands.insertContent(" ");
    return hrefs(target);
  }

  it("drops pasted relative and tel: links, keeping their text", async () => {
    const target = await open();
    target.commands.insertContent(
      '<p><a href="#intro">frag</a> <a href="/about">path</a> <a href="tel:+14155550123">call</a></p>',
    );
    expect(hrefs(target)).toEqual([]);
    expect(target.state.doc.textContent).toContain("frag path call");
  });

  it.each([
    ["a phone number", "+14155550123"],
    ["an app link", "vscode://evil.extension/run"],
  ])("does not autolink %s", async (_, word) => {
    expect(await typeWord(word)).toEqual([]);
  });

  it("still autolinks a typed web address", async () => {
    expect(await typeWord("https://example.com")).toEqual([
      "https://example.com",
    ]);
  });
});
