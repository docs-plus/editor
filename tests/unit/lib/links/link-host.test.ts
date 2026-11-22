import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";

import { Hyperlink } from "@docs.plus/extension-hyperlink";
import { Editor } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { relativePositionToAbsolutePosition } from "@tiptap/y-tiptap";

import { docHref, hereHref } from "@/lib/links/doc-link";
import {
  LINK_COPY,
  MERGE_DELETED_INTO_NOT_AVAILABLE,
} from "@/lib/links/link-copy";
import {
  createLinkHost,
  isAllowedLinkUri,
  type LinkHostDeps,
  openAtHeading,
} from "@/lib/links/link-host";
import type { LinkFollow } from "@/lib/links/navigate";
import type { LinkIndexSnapshot } from "@/lib/links/resolve";
import { createCollabEditor } from "@/tests/helpers/collab-editor";

const KEY = "a".repeat(32);
const TOC = "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b";

const LIVE: LinkIndexSnapshot = {
  items: [{ id: "doc-a", title: "Q4 budget", createdAt: 0, linkKey: KEY }],
};

const cleanups: (() => void)[] = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
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

/** Two frames: `openAtHeading` re-scrolls on the second. */
const frames = (count: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) =>
      left === 0 ? resolve() : requestAnimationFrame(() => step(left - 1));
    step(count);
  });

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

  it("allows only https, http and mailto otherwise, after the extension's gate", () => {
    const ctx = { defaultValidate: mock(() => true) };
    for (const uri of ["https://example.com", "http://x.y", "MAILTO:a@b.c"]) {
      expect(isAllowedLinkUri(uri, ctx)).toBe(true);
    }
    for (const uri of [
      "ms-msdt:/id x",
      "search-ms:query=x",
      "smb://evil/share",
      "vscode://evil/run",
      "ftp://example.com",
    ]) {
      expect(isAllowedLinkUri(uri, ctx)).toBe(false);
    }
    const refuse = { defaultValidate: mock(() => false) };
    expect(isAllowedLinkUri("https://example.com", refuse)).toBe(false);
  });
});

describe("createLinkHost (search-linking §4.1)", () => {
  it("registers no linkify protocol (typed tinydocy: never autolinks)", () => {
    const { host } = setup();
    expect(host.protocols).toBeUndefined();
  });

  it("brings its own popovers: the document preview for document links", () => {
    const { host } = setup();
    expect(typeof host.popovers?.previewHyperlink).toBe("function");
    expect(typeof host.popovers?.editHyperlink).toBe("function");
    expect(typeof host.popovers?.createHyperlink).toBe("function");
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
      title: "Q4 budget",
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
      title: "Q4 budget",
    });
    expect(deps.onFollow).toHaveBeenCalledTimes(2);
  });

  it("uses purged keys when the host has them", () => {
    const { host, deps } = setup({
      purgedKeys: () => new Set(["c".repeat(32)]),
    });
    host.navigate?.(docHref("c".repeat(32)), { newTab: false });
    expect(deps.announce).toHaveBeenCalledWith(
      MERGE_DELETED_INTO_NOT_AVAILABLE
        ? LINK_COPY.notAvailable
        : LINK_COPY.deleted,
    );
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
      title: "Q4 budget",
    });
  });

  it("two create/dispose cycles leave no window listeners behind", () => {
    const added = spyOn(window, "addEventListener");
    const removed = spyOn(window, "removeEventListener");
    const key = ([type, listener, options]: unknown[]) => {
      const capture =
        typeof options === "boolean"
          ? options
          : Boolean((options as AddEventListenerOptions | undefined)?.capture);
      return { type, listener, capture };
    };
    try {
      for (let cycle = 0; cycle < 2; cycle++) {
        createLinkHost({
          getSnapshot: () => LIVE,
          openDocument() {},
          goToHeadingHere: () => false,
          openExternal() {},
          announce() {},
        }).dispose();
      }
      const live = added.mock.calls.map(key);
      for (const call of removed.mock.calls.map(key)) {
        const at = live.findIndex(
          (entry) =>
            entry.type === call.type &&
            entry.listener === call.listener &&
            entry.capture === call.capture,
        );
        if (at >= 0) live.splice(at, 1);
      }
      expect(added).toHaveBeenCalled();
      expect(live).toEqual([]);
    } finally {
      added.mockRestore();
      removed.mockRestore();
    }
  });
});

/** Headings with their `data-toc-id`, as the app's schema keeps them. */
const TocHeading = Heading.extend({
  addAttributes() {
    return { ...this.parent?.(), "data-toc-id": { default: null } };
  },
});

function headingDoc(withTravel: boolean) {
  return {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1, "data-toc-id": "title" },
        content: [{ type: "text", text: "Q4 budget" }],
      },
      ...(withTravel
        ? [
            {
              type: "heading",
              attrs: { level: 2, "data-toc-id": TOC },
              content: [{ type: "text", text: "Travel" }],
            },
          ]
        : []),
    ],
  };
}

describe("openAtHeading (search-linking §4.3, §4.4)", () => {
  function target(withTravel: boolean): Editor {
    const element = document.createElement("div");
    document.body.append(element);
    const editor = new Editor({
      element,
      extensions: [Document, Paragraph, Text, TocHeading],
      content: headingDoc(withTravel),
    });
    cleanups.push(() => {
      if (!editor.isDestroyed) editor.destroy();
      element.remove();
    });
    return editor;
  }

  function options(overrides: { waitForSync?: Promise<unknown> } = {}) {
    return {
      title: "Q4 budget",
      goToHeading: mock(() => true),
      announce: mock(() => {}),
      ...overrides,
    };
  }

  it("goes to the heading at the start and says where it landed", async () => {
    const editor = target(true);
    const opts = options();
    expect(await openAtHeading(editor, TOC, opts)).toBe(true);
    expect(opts.goToHeading).toHaveBeenCalledWith(editor, TOC, "start");
    expect(opts.announce).toHaveBeenCalledTimes(1);
    expect(opts.announce).toHaveBeenCalledWith(
      LINK_COPY.opened("Q4 budget", "Travel"),
    );
  });

  it("scrolls the heading to the top again on the second frame", async () => {
    const editor = target(true);
    const scroll = spyOn(HTMLElement.prototype, "scrollIntoView");
    try {
      await openAtHeading(editor, TOC, options());
      await frames(1);
      expect(scroll).not.toHaveBeenCalled();
      await frames(2);
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll).toHaveBeenCalledWith({ block: "start" });
      const heading = scroll.mock.contexts[0] as unknown as HTMLElement;
      expect(heading.getAttribute("data-toc-id")).toBe(TOC);
    } finally {
      scroll.mockRestore();
    }
  });

  it("says the section was removed when the heading is gone", async () => {
    const opts = options();
    expect(await openAtHeading(target(false), TOC, opts)).toBe(false);
    expect(opts.goToHeading).not.toHaveBeenCalled();
    expect(opts.announce).toHaveBeenCalledTimes(1);
    expect(opts.announce).toHaveBeenCalledWith(LINK_COPY.headingRemoved);
  });

  it("retries once after the first server sync", async () => {
    const editor = target(false);
    let synced!: () => void;
    const opts = options({
      waitForSync: new Promise<void>((resolve) => {
        synced = resolve;
      }),
    });
    const done = openAtHeading(editor, TOC, opts);
    await Promise.resolve();
    expect(opts.announce).not.toHaveBeenCalled();
    // The server's copy arrives with the heading.
    editor.commands.setContent(headingDoc(true));
    synced();
    expect(await done).toBe(true);
    expect(opts.announce).toHaveBeenCalledTimes(1);
    expect(opts.announce).toHaveBeenCalledWith(
      LINK_COPY.opened("Q4 budget", "Travel"),
    );
  });

  it("says removed once when the heading is still gone after the sync", async () => {
    const opts = options({ waitForSync: Promise.resolve() });
    expect(await openAtHeading(target(false), TOC, opts)).toBe(false);
    expect(opts.announce).toHaveBeenCalledTimes(1);
    expect(opts.announce).toHaveBeenCalledWith(LINK_COPY.headingRemoved);
  });

  it("treats a failed sync like a sync without the heading", async () => {
    const opts = options({ waitForSync: Promise.reject(new Error("offline")) });
    expect(await openAtHeading(target(false), TOC, opts)).toBe(false);
    expect(opts.announce).toHaveBeenCalledTimes(1);
    expect(opts.announce).toHaveBeenCalledWith(LINK_COPY.headingRemoved);
  });

  it("says nothing when the editor closes while it waits", async () => {
    const editor = target(false);
    let synced!: () => void;
    const opts = options({
      waitForSync: new Promise<void>((resolve) => {
        synced = resolve;
      }),
    });
    const done = openAtHeading(editor, TOC, opts);
    editor.destroy();
    synced();
    expect(await done).toBe(false);
    expect(opts.announce).not.toHaveBeenCalled();
  });

  it("says removed when goToHeading can't go there", async () => {
    const opts = { ...options(), goToHeading: mock(() => false) };
    expect(await openAtHeading(target(true), TOC, opts)).toBe(false);
    expect(opts.announce).toHaveBeenCalledTimes(1);
    expect(opts.announce).toHaveBeenCalledWith(LINK_COPY.headingRemoved);
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

  function link(editor: Editor, href: string, from = 1, to = 5): boolean {
    return editor
      .chain()
      .setTextSelection({ from, to })
      .setHyperlink({ href })
      .run();
  }

  /** Mod-click as a person does it: the extension follows on Mod. */
  function modClick(anchor: Element) {
    for (const type of ["mousedown", "mouseup", "click"]) {
      anchor.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          button: 0,
          metaKey: true,
          ctrlKey: true,
        }),
      );
    }
  }

  it("writes a valid document link unchanged and draws its state icon", () => {
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

  it("follows a document link on Mod-click without a linkify protocol", () => {
    const { host, deps } = setup();
    const editor = createEditor(host);
    link(editor, docHref(KEY));
    const anchor = editor.view.dom.querySelector("a[href]");
    if (!anchor) throw new Error("no link");
    const open = spyOn(window, "open").mockImplementation(() => null);
    try {
      modClick(anchor);
      expect(deps.openDocument).toHaveBeenCalledTimes(1);
      expect(deps.openDocument).toHaveBeenCalledWith("doc-a", {
        newTab: false,
        tocId: null,
        title: "Q4 budget",
      });
      expect(open).not.toHaveBeenCalled();
    } finally {
      open.mockRestore();
    }
  });

  it("hands onFollow the clicked link as a Yjs relative position", () => {
    let source: { docId: string; editor: Editor } | null = null;
    const onFollow = mock((_event: LinkFollow) => {});
    const { host } = setup({ getSource: () => source, onFollow });
    const fixture = createCollabEditor({
      extensions: [Hyperlink.configure({ ...host })],
    });
    cleanups.push(fixture.destroy);
    document.body.append(fixture.editor.view.dom);
    cleanups.push(() => fixture.editor.view.dom.remove());
    source = { docId: "doc-here", editor: fixture.editor };
    // "Title" then "hello world": link "world" (14..19).
    expect(link(fixture.editor, docHref(KEY), 14, 19)).toBe(true);
    const anchor = fixture.editor.view.dom.querySelector("a[href]");
    if (!anchor) throw new Error("no link");

    modClick(anchor);

    expect(onFollow).toHaveBeenCalledTimes(1);
    const [[event]] = onFollow.mock.calls;
    expect(event.source.docId).toBe("doc-here");
    const binding = fixture.binding();
    if (!binding || !event.source.position) throw new Error("no position");
    expect(
      relativePositionToAbsolutePosition(
        binding.doc,
        binding.type,
        event.source.position,
        binding.mapping,
      ),
    ).toBe(14);
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
