import { afterEach, describe, expect, it, mock } from "bun:test";

import { Editor } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";

import { docHref, hereHref } from "@/lib/links/doc-link";
import { LINK_COPY } from "@/lib/links/link-copy";
import {
  createLinkNavigator,
  type LinkNavigatorDeps,
} from "@/lib/links/navigate";
import { type LinkIndexSnapshot, resolveDocLink } from "@/lib/links/resolve";

const KEY = "a".repeat(32);
const TRASHED_KEY = "b".repeat(32);
const PURGED_KEY = "c".repeat(32);
const UNKNOWN_KEY = "d".repeat(32);
const TOC = "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b";
const EMPTY_TOC = "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5c";

const SNAPSHOT: LinkIndexSnapshot = {
  items: [{ id: "doc-a", title: "Q4 budget", createdAt: 0, linkKey: KEY }],
  trashed: [{ id: "doc-b", title: "Old", createdAt: 0, linkKey: TRASHED_KEY }],
};

/** Headings with their `data-toc-id`, as the app's schema keeps them. */
const TocHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      "data-toc-id": { default: null },
    };
  },
});

const editors: Editor[] = [];
afterEach(() => {
  for (const editor of editors.splice(0)) editor.destroy();
});

/** The open document: a "Travel" heading and an empty one. */
function sourceEditor(): Editor {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions: [Document, Paragraph, Text, TocHeading],
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1, "data-toc-id": TOC },
          content: [{ type: "text", text: "Travel" }],
        },
        { type: "heading", attrs: { level: 2, "data-toc-id": EMPTY_TOC } },
      ],
    },
  });
  editors.push(editor);
  return editor;
}

function setup(overrides: Partial<LinkNavigatorDeps> = {}) {
  const editor = sourceEditor();
  const deps = {
    resolve: mock((href: string) =>
      resolveDocLink(href, {
        snapshot: SNAPSHOT,
        purgedKeys: new Set([PURGED_KEY]),
      }),
    ),
    openDocument: mock(() => {}),
    goToHeadingHere: mock(() => true),
    openExternal: mock(() => {}),
    announce: mock(() => {}),
    wantsNewTab: mock(() => false),
    lastAnchor: mock(() => null),
    getSource: mock(() => ({ docId: "doc-here", editor })),
    onFollow: mock(() => {}),
    ...overrides,
  };
  return { deps, editor, navigate: createLinkNavigator(deps) };
}

const NOT_AVAILABLE = LINK_COPY.notAvailable;
const LATER = "tinydocy:folder/abc";

describe("createLinkNavigator (search-linking §4.3)", () => {
  it("opens a document in this tab on Mod alone", () => {
    const { deps, navigate } = setup();
    navigate(docHref(KEY, TOC), { newTab: true });
    expect(deps.openDocument).toHaveBeenCalledWith("doc-a", {
      newTab: false,
      tocId: TOC,
      title: "Q4 budget",
    });
  });

  it("opens in a new tab on Mod+Shift or middle", () => {
    const { deps, navigate } = setup({ wantsNewTab: mock(() => true) });
    navigate(docHref(KEY), { newTab: true });
    expect(deps.openDocument).toHaveBeenCalledWith("doc-a", {
      newTab: true,
      tocId: null,
      title: "Q4 budget",
    });
  });

  it("stays in this tab when the extension asks for none", () => {
    const { deps, navigate } = setup({ wantsNewTab: mock(() => true) });
    navigate(docHref(KEY), { newTab: false });
    expect(deps.openDocument).toHaveBeenCalledWith("doc-a", {
      newTab: false,
      tocId: null,
      title: "Q4 budget",
    });
  });

  it("opens a trashed document (the editor shows the In Trash banner)", () => {
    const { deps, navigate } = setup();
    navigate(docHref(TRASHED_KEY), { newTab: false });
    expect(deps.openDocument).toHaveBeenCalledWith("doc-b", {
      newTab: false,
      tocId: null,
      title: "Old",
    });
  });

  it("goes to a heading here", () => {
    const { deps, navigate } = setup();
    navigate(hereHref(TOC), { newTab: true });
    expect(deps.goToHeadingHere).toHaveBeenCalledWith(TOC);
    expect(deps.openDocument).not.toHaveBeenCalled();
  });

  it("never hands one of ours to openExternal", () => {
    for (const href of [
      `TINYDOCY:doc/${KEY}`,
      ` tinydocy:doc/${KEY}`,
      "tinydocy://local/x",
      docHref(KEY),
      hereHref(TOC),
    ]) {
      for (const newTab of [false, true]) {
        const { deps, navigate } = setup();
        navigate(href, { newTab });
        expect(deps.openExternal).not.toHaveBeenCalled();
      }
    }
  });

  it("never hands one of ours to openExternal even when resolve returns null", () => {
    const { deps, navigate } = setup({ resolve: mock(() => null) });
    navigate(docHref(KEY), { newTab: true });
    expect(deps.openExternal).not.toHaveBeenCalled();
    expect(deps.announce).toHaveBeenCalledWith(LINK_COPY.invalid);
  });

  it("never opens anything but https, http and mailto externally", () => {
    for (const href of [
      "ms-msdt:/id PCWDiagnostic /skip force",
      "search-ms:query=x",
      "smb://evil/share",
      "vscode://evil.extension/run",
      `\u00a0tinydocy:doc/${KEY}`,
      "ftp://example.com",
      "javascript:alert(1)",
    ]) {
      const { deps, navigate } = setup();
      navigate(href, { newTab: true });
      expect(deps.openExternal).not.toHaveBeenCalled();
    }
  });

  it("passes web links through unchanged, with no announcement or follow", () => {
    const { deps, navigate } = setup();
    navigate("https://example.com/a", { newTab: true });
    expect(deps.openExternal).toHaveBeenCalledWith("https://example.com/a", {
      newTab: true,
    });
    navigate("mailto:a@b.c", { newTab: false });
    expect(deps.openExternal).toHaveBeenCalledWith("mailto:a@b.c", {
      newTab: false,
    });
    expect(deps.wantsNewTab).not.toHaveBeenCalled();
    expect(deps.announce).not.toHaveBeenCalled();
    expect(deps.onFollow).not.toHaveBeenCalled();
  });
});

describe("one announcement per follow (search-linking §8)", () => {
  const cases: [name: string, href: string, message: string | null][] = [
    // openAtHeading announces once the target document is there.
    ["a document at a heading", docHref(KEY, TOC), null],
    ["a document", docHref(KEY), LINK_COPY.opened("Q4 budget")],
    ["a document in Trash", docHref(TRASHED_KEY), LINK_COPY.opened("Old")],
    ["a heading here", hereHref(TOC), LINK_COPY.atHeading("Travel")],
    [
      "an empty heading here",
      hereHref(EMPTY_TOC),
      LINK_COPY.atHeading("Untitled"),
    ],
    ["a deleted document", docHref(PURGED_KEY), NOT_AVAILABLE],
    ["a document not in the library", docHref(UNKNOWN_KEY), NOT_AVAILABLE],
    ["an invalid link", "tinydocy:doc/BAD", LINK_COPY.invalid],
    ["a newer link form", LATER, LINK_COPY.unknownForm],
  ];
  for (const [name, href, message] of cases) {
    it(`${name}: ${message ?? "nothing (openAtHeading speaks)"}`, () => {
      const { deps, navigate } = setup();
      navigate(href, { newTab: false });
      if (message === null) {
        expect(deps.announce).not.toHaveBeenCalled();
      } else {
        expect(deps.announce).toHaveBeenCalledTimes(1);
        expect(deps.announce).toHaveBeenCalledWith(message);
      }
    });
  }

  it("a heading here that is gone: the section was removed", () => {
    const { deps, navigate } = setup({ goToHeadingHere: mock(() => false) });
    navigate(hereHref(TOC), { newTab: false });
    expect(deps.announce).toHaveBeenCalledTimes(1);
    expect(deps.announce).toHaveBeenCalledWith(LINK_COPY.headingRemoved);
  });

  it("a heading here can't say where it landed without the source editor", () => {
    // Hosts pass `getSource` for this announcement.
    const { deps, navigate } = setup({ getSource: undefined });
    navigate(hereHref(TOC), { newTab: false });
    expect(deps.goToHeadingHere).toHaveBeenCalledWith(TOC);
    expect(deps.announce).not.toHaveBeenCalled();
  });
});

describe("showPreview: a follow that can't open shows the link's card", () => {
  const cases = [
    ["not_available (deleted)", docHref(PURGED_KEY)],
    ["not_available (not in the library)", docHref(UNKNOWN_KEY)],
    ["invalid", "tinydocy:doc/BAD"],
    ["unknown_form", LATER],
  ] as const;
  for (const [name, href] of cases) {
    it(`${name}: the card, and no announcement`, () => {
      const showPreview = mock(() => true);
      const { deps, navigate } = setup({ showPreview });
      navigate(href, { newTab: true });
      expect(showPreview).toHaveBeenCalledTimes(1);
      expect(showPreview).toHaveBeenCalledWith(href);
      expect(deps.announce).not.toHaveBeenCalled();
      expect(deps.openDocument).not.toHaveBeenCalled();
      expect(deps.openExternal).not.toHaveBeenCalled();
      expect(deps.onFollow).not.toHaveBeenCalled();
    });

    it(`${name}: announces when no card can be shown`, () => {
      const showPreview = mock(() => false);
      const { deps, navigate } = setup({ showPreview });
      navigate(href, { newTab: false });
      expect(showPreview).toHaveBeenCalledTimes(1);
      expect(deps.announce).toHaveBeenCalledTimes(1);
    });
  }

  it("never shows a card for links that open", () => {
    const showPreview = mock(() => true);
    const { deps, navigate } = setup({ showPreview });
    navigate(docHref(KEY), { newTab: false });
    navigate(docHref(TRASHED_KEY), { newTab: false });
    navigate(hereHref(TOC), { newTab: false });
    navigate("https://example.com", { newTab: false });
    expect(showPreview).not.toHaveBeenCalled();
    expect(deps.openDocument).toHaveBeenCalledTimes(2);
  });

  it("shows no card for a heading here that is gone (it announces)", () => {
    const showPreview = mock(() => true);
    const { deps, navigate } = setup({
      showPreview,
      goToHeadingHere: mock(() => false),
    });
    navigate(hereHref(TOC), { newTab: false });
    expect(showPreview).not.toHaveBeenCalled();
    expect(deps.announce).toHaveBeenCalledWith(LINK_COPY.headingRemoved);
  });
});

describe("onFollow (search-linking §4.3, Back)", () => {
  const followed = [
    ["resolves", docHref(KEY, TOC)],
    ["in_trash", docHref(TRASHED_KEY)],
    ["here", hereHref(TOC)],
  ] as const;
  for (const [state, href] of followed) {
    it(`fires once for ${state}, with the source document`, () => {
      const { deps, navigate } = setup();
      navigate(href, { newTab: false });
      expect(deps.onFollow).toHaveBeenCalledTimes(1);
      expect(deps.onFollow).toHaveBeenCalledWith({
        href,
        to: expect.objectContaining({ state }),
        // No Yjs binding on this editor, so no position.
        source: { docId: "doc-here", position: null },
      });
    });
  }

  const broken = [
    ["deleted", docHref(PURGED_KEY)],
    ["not_in_library", docHref(UNKNOWN_KEY)],
    ["invalid", "tinydocy:doc/BAD"],
    ["unknown_form", LATER],
  ] as const;
  for (const [state, href] of broken) {
    it(`never fires for ${state}`, () => {
      const { deps, navigate } = setup();
      navigate(href, { newTab: true });
      expect(deps.openDocument).not.toHaveBeenCalled();
      expect(deps.onFollow).not.toHaveBeenCalled();
    });
  }

  it("never fires for a heading here that is gone", () => {
    const { deps, navigate } = setup({ goToHeadingHere: mock(() => false) });
    navigate(hereHref(TOC), { newTab: false });
    expect(deps.onFollow).not.toHaveBeenCalled();
  });

  it("carries a null source when the host has no open document", () => {
    const { deps, navigate } = setup({ getSource: mock(() => null) });
    navigate(docHref(KEY), { newTab: false });
    expect(deps.onFollow).toHaveBeenCalledWith(
      expect.objectContaining({ source: { docId: null, position: null } }),
    );
  });

  it("reads the source before the target replaces it", () => {
    let current: string | null = "doc-here";
    const { deps, navigate, editor } = setup({
      getSource: mock(() => (current ? { docId: current, editor } : null)),
      openDocument: mock(() => {
        current = "doc-a";
      }),
    });
    navigate(docHref(KEY), { newTab: false });
    expect(deps.onFollow).toHaveBeenCalledWith(
      expect.objectContaining({
        source: { docId: "doc-here", position: null },
      }),
    );
  });
});
