import { describe, expect, it, mock } from "bun:test";

import { docHref, hereHref } from "@/lib/links/doc-link";
import {
  createLinkNavigator,
  LINK_MESSAGES,
  type LinkNavigatorDeps,
} from "@/lib/links/navigate";
import { type LinkIndexSnapshot, resolveDocLink } from "@/lib/links/resolve";

const KEY = "a".repeat(32);
const TRASHED_KEY = "b".repeat(32);
const PURGED_KEY = "c".repeat(32);
const UNKNOWN_KEY = "d".repeat(32);
const TOC = "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b";

const SNAPSHOT: LinkIndexSnapshot = {
  items: [{ id: "doc-a", title: "Q4 budget", createdAt: 0, linkKey: KEY }],
  trashed: [{ id: "doc-b", title: "Old", createdAt: 0, linkKey: TRASHED_KEY }],
};

function setup(overrides: Partial<LinkNavigatorDeps> = {}) {
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
    onFollow: mock(() => {}),
    ...overrides,
  };
  return { deps, navigate: createLinkNavigator(deps) };
}

describe("createLinkNavigator (search-linking §4.3)", () => {
  it("opens a document in this tab on Mod alone", () => {
    const { deps, navigate } = setup();
    navigate(docHref(KEY, TOC), { newTab: true });
    expect(deps.openDocument).toHaveBeenCalledWith("doc-a", {
      newTab: false,
      tocId: TOC,
    });
    expect(deps.onFollow).toHaveBeenCalledWith({
      href: docHref(KEY, TOC),
      to: expect.objectContaining({ state: "resolves", docId: "doc-a" }),
    });
  });

  it("opens in a new tab on Mod+Shift or middle", () => {
    const { deps, navigate } = setup({ wantsNewTab: mock(() => true) });
    navigate(docHref(KEY), { newTab: true });
    expect(deps.openDocument).toHaveBeenCalledWith("doc-a", {
      newTab: true,
      tocId: null,
    });
  });

  it("stays in this tab when the extension asks for none", () => {
    const { deps, navigate } = setup({ wantsNewTab: mock(() => true) });
    navigate(docHref(KEY), { newTab: false });
    expect(deps.openDocument).toHaveBeenCalledWith("doc-a", {
      newTab: false,
      tocId: null,
    });
  });

  it("opens a trashed document (the editor shows the In Trash banner)", () => {
    const { deps, navigate } = setup();
    navigate(docHref(TRASHED_KEY), { newTab: false });
    expect(deps.openDocument).toHaveBeenCalledWith("doc-b", {
      newTab: false,
      tocId: null,
    });
    expect(deps.onFollow).toHaveBeenCalledTimes(1);
  });

  it("goes to a heading here", () => {
    const { deps, navigate } = setup();
    navigate(hereHref(TOC), { newTab: true });
    expect(deps.goToHeadingHere).toHaveBeenCalledWith(TOC);
    expect(deps.openDocument).not.toHaveBeenCalled();
    expect(deps.announce).not.toHaveBeenCalled();
    expect(deps.onFollow).toHaveBeenCalledTimes(1);
  });

  it("announces a removed heading here and records no follow", () => {
    const { deps, navigate } = setup({ goToHeadingHere: mock(() => false) });
    navigate(hereHref(TOC), { newTab: false });
    expect(deps.announce).toHaveBeenCalledWith(LINK_MESSAGES.headingRemoved);
    expect(deps.onFollow).not.toHaveBeenCalled();
  });

  it("announces broken states without moving", () => {
    const cases: [string, string][] = [
      [docHref(PURGED_KEY), "This document was deleted."],
      [
        docHref(UNKNOWN_KEY),
        "This links to a document that isn't in your library.",
      ],
      ["tinydocy:doc/BAD", "This link needs a newer version of TinyDocy."],
    ];
    for (const [href, message] of cases) {
      const { deps, navigate } = setup();
      navigate(href, { newTab: true });
      expect(deps.announce).toHaveBeenCalledWith(message);
      expect(deps.openDocument).not.toHaveBeenCalled();
      expect(deps.openExternal).not.toHaveBeenCalled();
      expect(deps.onFollow).not.toHaveBeenCalled();
    }
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
    expect(deps.announce).toHaveBeenCalledWith(LINK_MESSAGES.unknownForm);
  });

  it("passes web links through unchanged", () => {
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
    expect(deps.onFollow).not.toHaveBeenCalled();
  });
});
