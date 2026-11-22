import { describe, expect, it } from "bun:test";

import { docHref, hereHref } from "@/lib/links/doc-link";
import { type LinkIndexSnapshot, resolveDocLink } from "@/lib/links/resolve";
import type { DocumentEntry, FolderEntry } from "@/lib/platform/document-index";

const KEY_A = "a".repeat(32);
const KEY_B = "b".repeat(32);
const KEY_GONE = "c".repeat(32);
const KEY_PURGED = "d".repeat(32);
const TOC = "6f1c2a3b-4d5e-4f60-8a9b-0c1d2e3f4a5b";

const folder = (
  id: string,
  name: string,
  parentId: string | null,
): FolderEntry => ({ id, name, parentId, createdAt: 0 });

const doc = (
  id: string,
  title: string,
  extra: Partial<DocumentEntry> = {},
): DocumentEntry => ({ id, title, createdAt: 0, ...extra });

function snapshot(): LinkIndexSnapshot {
  return {
    items: [
      doc("doc-a", "Q4 budget", { linkKey: KEY_A, folderId: "travel" }),
      doc("sandbox", "No key"),
    ],
    folders: [
      folder("finance", "Finance", null),
      folder("travel", "Travel", "finance"),
    ],
    trashed: [doc("doc-b", "  ", { linkKey: KEY_B })],
  };
}

describe("resolveDocLink (search-linking §4.6)", () => {
  it("returns null for hrefs that aren't ours", () => {
    const source = { snapshot: snapshot() };
    expect(resolveDocLink("https://example.com", source)).toBeNull();
    expect(resolveDocLink("mailto:a@b.c", source)).toBeNull();
    expect(resolveDocLink("", source)).toBeNull();
  });

  it("resolves a key in the library with its folder path", () => {
    expect(resolveDocLink(docHref(KEY_A), { snapshot: snapshot() })).toEqual({
      state: "resolves",
      docId: "doc-a",
      title: "Q4 budget",
      path: ["Finance", "Travel"],
      tocId: null,
    });
  });

  it("carries the heading id", () => {
    const state = resolveDocLink(docHref(KEY_A, TOC), { snapshot: snapshot() });
    expect(state).toMatchObject({ state: "resolves", tocId: TOC });
  });

  it("gives an empty path at the Library root", () => {
    const snap: LinkIndexSnapshot = {
      items: [doc("root", "Root doc", { linkKey: KEY_A })],
    };
    expect(resolveDocLink(docHref(KEY_A), { snapshot: snap })).toMatchObject({
      state: "resolves",
      path: [],
    });
  });

  it("says In Trash for a trashed key, with the display title", () => {
    expect(
      resolveDocLink(docHref(KEY_B, TOC), { snapshot: snapshot() }),
    ).toEqual({
      state: "in_trash",
      docId: "doc-b",
      title: "Untitled",
      tocId: TOC,
    });
  });

  it("says deleted only for a purged key", () => {
    const source = {
      snapshot: snapshot(),
      purgedKeys: new Set([KEY_PURGED]),
    };
    expect(resolveDocLink(docHref(KEY_PURGED), source)).toEqual({
      state: "deleted",
    });
    expect(resolveDocLink(docHref(KEY_GONE), source)).toEqual({
      state: "not_in_library",
    });
  });

  it("prefers a live entry over a purge record", () => {
    const source = { snapshot: snapshot(), purgedKeys: new Set([KEY_A]) };
    expect(resolveDocLink(docHref(KEY_A), source)?.state).toBe("resolves");
  });

  it("reads tinydocy: hrefs that don't parse as an unknown form", () => {
    const source = { snapshot: snapshot() };
    for (const href of [
      "tinydocy://local/x",
      `TINYDOCY:doc/${KEY_A}`,
      ` tinydocy:doc/${KEY_A}`,
      "tinydocy:doc/BAD",
      "tinydocy:here",
    ]) {
      expect(resolveDocLink(href, source)).toEqual({ state: "unknown_form" });
    }
  });

  it("resolves here# links without the index", () => {
    expect(resolveDocLink(hereHref(TOC), { snapshot: { items: [] } })).toEqual({
      state: "here",
      tocId: TOC,
    });
  });

  it("follows a new snapshot object (rename, trash)", () => {
    const first = snapshot();
    expect(resolveDocLink(docHref(KEY_A), { snapshot: first })).toMatchObject({
      title: "Q4 budget",
    });
    const renamed: LinkIndexSnapshot = {
      ...first,
      items: [doc("doc-a", "Q1 budget", { linkKey: KEY_A })],
    };
    expect(resolveDocLink(docHref(KEY_A), { snapshot: renamed })).toMatchObject(
      { state: "resolves", title: "Q1 budget", path: [] },
    );
    const trashed: LinkIndexSnapshot = {
      items: [],
      trashed: [doc("doc-a", "Q1 budget", { linkKey: KEY_A })],
    };
    expect(resolveDocLink(docHref(KEY_A), { snapshot: trashed })?.state).toBe(
      "in_trash",
    );
  });
});
