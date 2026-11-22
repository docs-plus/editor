import { afterEach, describe, expect, it, mock } from "bun:test";

import { Hyperlink } from "@docs.plus/extension-hyperlink";
import { Editor } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";

import { docHref, hereHref } from "@/lib/links/doc-link";
import {
  createLinkHost,
  isAllowedLinkUri,
  type LinkHostDeps,
  openAtHeading,
} from "@/lib/links/link-host";
import { LINK_MESSAGES } from "@/lib/links/navigate";
import type { LinkIndexSnapshot } from "@/lib/links/resolve";

const KEY = "a".repeat(32);
const TOC = "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b";

const LIVE: LinkIndexSnapshot = {
  items: [{ id: "doc-a", title: "Q4 budget", createdAt: 0, linkKey: KEY }],
};

let cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  cleanups = [];
});

function setup(overrides: Partial<LinkHostDeps> = {}) {
  let snapshot = LIVE;
  const deps = {
    getSnapshot: () => snapshot,
    openDocument: mock(() => {}),
    goToHeadingHere: mock(() => true),
    openExternal: mock(() => {}),
    announce: mock(() => {}),
    onFollow: mock(() => {}),
    ...overrides,
  };
  const created = createLinkHost(deps);
  cleanups.push(created.dispose);
  return {
    deps,
    ...created,
    setSnapshot(next: LinkIndexSnapshot) {
      snapshot = next;
    },
  };
}

const defaultValidate = (uri: string) => /^https?:/.test(uri);

describe("isAllowedLinkUri (search-linking §4.1)", () => {
  it("writes only document links that parse", () => {
    const ctx = { defaultValidate: mock(defaultValidate) };
    expect(isAllowedLinkUri(docHref(KEY), ctx)).toBe(true);
    expect(isAllowedLinkUri(docHref(KEY, TOC), ctx)).toBe(true);
    expect(isAllowedLinkUri(hereHref(TOC), ctx)).toBe(true);
    expect(isAllowedLinkUri("tinydocy:doc/BAD", ctx)).toBe(false);
    expect(isAllowedLinkUri("tinydocy://local/x", ctx)).toBe(false);
    expect(isAllowedLinkUri(`TINYDOCY:doc/${KEY}`, ctx)).toBe(false);
    expect(ctx.defaultValidate).not.toHaveBeenCalled();
  });

  it("leaves every other href to the extension's policy", () => {
    const ctx = { defaultValidate: mock(defaultValidate) };
    expect(isAllowedLinkUri("https://example.com", ctx)).toBe(true);
    expect(isAllowedLinkUri("ftp://example.com", ctx)).toBe(false);
    expect(ctx.defaultValidate).toHaveBeenCalledTimes(2);
  });
});

describe("createLinkHost (search-linking §4.1)", () => {
  it("registers the tinydocy scheme with optional slashes", () => {
    const { host } = setup();
    expect(host.protocols).toEqual([
      { scheme: "tinydocy", optionalSlashes: true },
    ]);
  });

  it("keeps one host object that never changes", () => {
    const { host } = setup();
    expect(Object.isFrozen(host)).toBe(true);
  });

  it("reads the snapshot at call time", () => {
    const { host, setSnapshot } = setup();
    expect(host.linkIcon?.({ href: docHref(KEY) })?.dataset.linkState).toBe(
      "resolves",
    );
    setSnapshot({ items: [], trashed: LIVE.items });
    expect(host.linkIcon?.({ href: docHref(KEY) })?.dataset.linkState).toBe(
      "in_trash",
    );
  });

  it("maps Mod alone to this tab and Mod+Shift to a new tab", () => {
    const { host, deps } = setup();
    document.body.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, metaKey: true }),
    );
    host.navigate?.(docHref(KEY, TOC), { newTab: true });
    expect(deps.openDocument).toHaveBeenLastCalledWith("doc-a", {
      newTab: false,
      tocId: TOC,
    });
    document.body.dispatchEvent(
      new MouseEvent("mousedown", {
        bubbles: true,
        metaKey: true,
        shiftKey: true,
      }),
    );
    host.navigate?.(docHref(KEY, TOC), { newTab: true });
    expect(deps.openDocument).toHaveBeenLastCalledWith("doc-a", {
      newTab: true,
      tocId: TOC,
    });
    expect(deps.onFollow).toHaveBeenCalledTimes(2);
  });

  it("uses purged keys when the host has them", () => {
    const { host, deps } = setup({
      purgedKeys: () => new Set(["c".repeat(32)]),
    });
    host.navigate?.(docHref("c".repeat(32)), { newTab: false });
    expect(deps.announce).toHaveBeenCalledWith(LINK_MESSAGES.deleted);
  });

  it("stops tracking gestures once disposed", () => {
    const { host, deps, dispose } = setup();
    dispose();
    document.body.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, shiftKey: true }),
    );
    host.navigate?.(docHref(KEY), { newTab: true });
    expect(deps.openDocument).toHaveBeenLastCalledWith("doc-a", {
      newTab: false,
      tocId: null,
    });
  });
});

describe("openAtHeading (search-linking §4.3, §4.4)", () => {
  it("goes to the heading at the start of the viewport", () => {
    const editor = { id: "e" };
    const goToHeading = mock(() => true);
    const announce = mock(() => {});
    expect(openAtHeading(editor, TOC, goToHeading, announce)).toBe(true);
    expect(goToHeading).toHaveBeenCalledWith(editor, TOC, "start");
    expect(announce).not.toHaveBeenCalled();
  });

  it("says so when the heading is gone", () => {
    const announce = mock(() => {});
    expect(openAtHeading({}, TOC, () => false, announce)).toBe(false);
    expect(announce).toHaveBeenCalledWith(LINK_MESSAGES.headingRemoved);
  });
});

describe("the Hyperlink mark with the link host", () => {
  function createEditor(host: ReturnType<typeof setup>["host"]): Editor {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: [Document, Paragraph, Text, Hyperlink.configure({ ...host })],
      content: "<p>Link text here</p>",
    });
    cleanups.push(() => {
      editor.destroy();
      element.remove();
    });
    return editor;
  }

  const hrefs = (editor: Editor) =>
    Array.from(editor.view.dom.querySelectorAll("a[href]")).map((a) =>
      a.getAttribute("href"),
    );

  function link(editor: Editor, href: string): boolean {
    return editor
      .chain()
      .setTextSelection({ from: 1, to: 5 })
      .setHyperlink({ href })
      .run();
  }

  it("writes a valid document link and draws its state icon", () => {
    const { host } = setup();
    const editor = createEditor(host);
    expect(link(editor, docHref(KEY))).toBe(true);
    expect(hrefs(editor)).toEqual([docHref(KEY)]);
    const icon = editor.view.dom.querySelector(".doc-link-icon");
    expect(icon?.getAttribute("data-link-state")).toBe("resolves");
    expect(icon?.closest("a")?.getAttribute("href")).toBe(docHref(KEY));
    // The icon is decoration only: the document text is unchanged.
    expect(editor.getText()).toBe("Link text here");
  });

  it("writes a here# link", () => {
    const { host } = setup();
    const editor = createEditor(host);
    expect(link(editor, hereHref(TOC))).toBe(true);
    expect(hrefs(editor)).toEqual([hereHref(TOC)]);
  });

  it("refuses a document link that doesn't parse", () => {
    const { host } = setup();
    const editor = createEditor(host);
    expect(link(editor, "tinydocy:doc/BAD")).toBe(false);
    expect(link(editor, "tinydocy://local/x")).toBe(false);
    expect(hrefs(editor)).toEqual([]);
  });

  it("still writes web links, with no icon", () => {
    const { host } = setup();
    const editor = createEditor(host);
    expect(link(editor, "https://example.com")).toBe(true);
    expect(hrefs(editor)).toEqual(["https://example.com"]);
    expect(editor.view.dom.querySelector(".doc-link-icon")).toBeNull();
  });

  it("redraws stale icons in place after the index changes", async () => {
    const { host, refreshIcons, setSnapshot } = setup();
    const editor = createEditor(host);
    link(editor, docHref(KEY));
    const icon = () => editor.view.dom.querySelector(".doc-link-icon");
    const first = icon();
    expect(first?.getAttribute("data-link-state")).toBe("resolves");
    const transactions = mock(() => {});
    editor.on("transaction", transactions);

    setSnapshot({ items: [], trashed: LIVE.items });
    // The mark view draws its icon once and keeps it until the href changes.
    editor.view.dispatch(editor.state.tr.setMeta("probe", true));
    expect(icon()?.getAttribute("data-link-state")).toBe("resolves");
    transactions.mockClear();

    refreshIcons(editor.view.dom);
    expect(icon()).toBe(first);
    expect(icon()?.getAttribute("data-link-state")).toBe("in_trash");
    expect(icon()?.querySelector("path[d='M3 6h18']")).not.toBeNull();
    // ProseMirror's observer ignores changes inside the icon: no re-parse.
    await new Promise((resolve) => setTimeout(resolve, 20));
    editor.view.dispatch(editor.state.tr.setMeta("probe", true));
    expect(transactions).toHaveBeenCalledTimes(1);
    expect(icon()).toBe(first);
    expect(icon()?.getAttribute("data-link-state")).toBe("in_trash");
    expect(editor.getText()).toBe("Link text here");
    expect(hrefs(editor)).toEqual([docHref(KEY)]);
  });
});
