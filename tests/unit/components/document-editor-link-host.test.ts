import { describe, expect, it } from "bun:test";

import type { Extension, Mark } from "@tiptap/core";
import { Awareness } from "y-protocols/awareness";
import * as Y from "yjs";

import { buildDocumentEditorExtensions } from "@/components/document-editor/document-editor-config";
import type { LinkHost } from "@/lib/links/link-host-types";

/**
 * The editor's `linkHost` pass-through (search-linking §4.1, D23's 60 B
 * line): the host's options reach the Hyperlink mark as they are, and
 * without a host the mark is configured exactly as before.
 */
function hyperlinkOptions(linkHost?: LinkHost) {
  const ydoc = new Y.Doc();
  const extensions = buildDocumentEditorExtensions({
    documentId: "link-host",
    ydoc,
    awareness: new Awareness(ydoc),
    getProvider: () => null,
    canWrite: () => true,
    onFoldChange() {},
    onFilterChange() {},
    onTocUpdate() {},
    linkHost,
  }) as (Extension | Mark)[];
  const hyperlink = extensions.find((ext) => ext.name === "hyperlink");
  if (!hyperlink) throw new Error("no hyperlink mark");
  return hyperlink.options as Record<string, unknown>;
}

describe("document editor linkHost", () => {
  it("leaves the Hyperlink options alone without a host", () => {
    const options = hyperlinkOptions();
    expect(options.navigate).toBeUndefined();
    expect(options.linkIcon).toBeUndefined();
    expect(options.isAllowedUri).toBeUndefined();
    expect(options.protocols).toEqual([]);
    expect(Object.keys(options).sort()).toEqual(
      Object.keys(hyperlinkOptions(undefined)).sort(),
    );
  });

  it("passes the host's link options through", () => {
    const host: LinkHost = {
      protocols: [{ scheme: "tinydocy", optionalSlashes: true }],
      isAllowedUri: () => true,
      navigate: () => {},
      linkIcon: () => null,
    };
    const options = hyperlinkOptions(host);
    expect(options.protocols).toBe(host.protocols);
    expect(options.isAllowedUri).toBe(host.isAllowedUri);
    expect(options.navigate).toBe(host.navigate);
    expect(options.linkIcon).toBe(host.linkIcon);
    // The sandbox's own settings stay.
    expect(typeof options.shouldAutoLink).toBe("function");
    expect((options.HTMLAttributes as { rel: string }).rel).toContain("ugc");
  });
});
