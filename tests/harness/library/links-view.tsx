/**
 * `?view=links`: the LK1 link host on a small Tiptap editor beside the files
 * sidebar, with every search-linking §4.6 state seeded in one document
 * ("Links demo"). Opening a document swaps the editor's content; outputs in
 * the tab row record what `navigate` did, so the spec can check that our
 * scheme never reaches the external opener.
 */
import "@docs.plus/extension-hyperlink/styles.css";
import "@/lib/links/doc-links.css";

import { Hyperlink } from "@docs.plus/extension-hyperlink";
import { Editor, type JSONContent } from "@tiptap/core";
import { Document } from "@tiptap/extension-document";
import { Heading } from "@tiptap/extension-heading";
import { Paragraph } from "@tiptap/extension-paragraph";
import { Text } from "@tiptap/extension-text";
import { useEffect, useRef, useState } from "react";

import { LibraryProvider } from "@/components/library/library-context";
import { LibrarySidebar } from "@/components/library/library-sidebar";
import { announce } from "@/lib/announce";
import { docHref, hereHref } from "@/lib/links/doc-link";
import { createLinkHost, openAtHeading } from "@/lib/links/link-host";
import type { DocumentEntry, FolderEntry } from "@/lib/platform/document-index";
import { MemoryDocumentIndex } from "@/tests/helpers/memory-document-index";

const KEY = {
  budget: "1111111111111111aaaaaaaaaaaaaaaa",
  old: "2222222222222222bbbbbbbbbbbbbbbb",
  demo: "3333333333333333cccccccccccccccc",
  purged: "4444444444444444dddddddddddddddd",
  stranger: "5555555555555555eeeeeeeeeeeeeeee",
};
const TOC = {
  demoTitle: "00000000-0000-4000-8000-000000000001",
  demoSecond: "00000000-0000-4000-8000-000000000002",
  budgetTitle: "00000000-0000-4000-8000-000000000003",
  travel: "00000000-0000-4000-8000-000000000004",
  missing: "00000000-0000-4000-8000-0000000000ff",
};

const FOLDERS: FolderEntry[] = [
  { id: "f-work", name: "Work", parentId: null, createdAt: 1 },
];
const DOCS: DocumentEntry[] = [
  { id: "d-demo", title: "Links demo", createdAt: 1, linkKey: KEY.demo },
  {
    id: "d-budget",
    title: "Q4 budget",
    createdAt: 2,
    folderId: "f-work",
    linkKey: KEY.budget,
  },
  { id: "d-old", title: "Old plan", createdAt: 3, linkKey: KEY.old },
];

const heading = (id: string, text: string): JSONContent => ({
  type: "heading",
  attrs: { level: 1, "data-toc-id": id },
  content: [{ type: "text", text }],
});
const link = (text: string, href: string): JSONContent => ({
  type: "text",
  text,
  marks: [{ type: "hyperlink", attrs: { href } }],
});
const line = (label: string, text: string, href: string): JSONContent => ({
  type: "paragraph",
  content: [{ type: "text", text: `${label}: ` }, link(text, href)],
});

const CONTENT: Record<string, JSONContent> = {
  "d-demo": {
    type: "doc",
    content: [
      heading(TOC.demoTitle, "Links demo"),
      line("Resolves", "Q4 budget", docHref(KEY.budget)),
      line("Heading", "Q4 budget › Travel", docHref(KEY.budget, TOC.travel)),
      line(
        "Heading gone",
        "Q4 budget › Gone",
        docHref(KEY.budget, TOC.missing),
      ),
      line("In Trash", "Old plan", docHref(KEY.old)),
      line("Deleted", "A deleted note", docHref(KEY.purged)),
      line("Not in library", "Someone else's", docHref(KEY.stranger)),
      line("Newer version", "From the future", "tinydocy://local/doc/next"),
      line("Here", "Second section", hereHref(TOC.demoSecond)),
      line("External", "example.com", "https://example.com/"),
      heading(TOC.demoSecond, "Second section"),
      { type: "paragraph", content: [{ type: "text", text: "The end." }] },
    ],
  },
  "d-budget": {
    type: "doc",
    content: [
      heading(TOC.budgetTitle, "Q4 budget"),
      { type: "paragraph", content: [{ type: "text", text: "Numbers." }] },
      heading(TOC.travel, "Travel"),
      { type: "paragraph", content: [{ type: "text", text: "Trains." }] },
    ],
  },
};

/** Headings with their `data-toc-id`, as the app's schema keeps them. */
const TocHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      "data-toc-id": {
        default: null,
        parseHTML: (element) => element.getAttribute("data-toc-id"),
        renderHTML: (attrs) =>
          attrs["data-toc-id"] ? { "data-toc-id": attrs["data-toc-id"] } : {},
      },
    };
  },
});

/** The harness's `goToHeading`: the app's needs the fold and outline. */
function goToHeading(editor: Editor, id: string): boolean {
  let at = -1;
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === "heading" && node.attrs["data-toc-id"] === id) {
      at = offset + node.nodeSize - 1;
    }
  });
  if (at < 0) return false;
  editor.chain().setTextSelection(at).focus().run();
  return true;
}

/** The links view's own library: "Old plan" is in Trash from the start. */
function createLinksLibrary(): MemoryDocumentIndex {
  const index = new MemoryDocumentIndex({ items: DOCS, folders: FOLDERS });
  void index.trash(["d-old"]);
  (window as unknown as { __library: MemoryDocumentIndex }).__library = index;
  return index;
}

/** A key a purge left behind; no index records these yet. */
const purged: ReadonlySet<string> = new Set([KEY.purged]);

export function LinksHarness() {
  const [index] = useState(createLinksLibrary);
  const [docId, setDocId] = useState("d-demo");
  const [lastOpen, setLastOpen] = useState("");
  const [external, setExternal] = useState<string[]>([]);
  const [follows, setFollows] = useState(0);
  const mount = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const openDoc = useRef<(id: string, tocId: string | null) => void>(() => {});

  // One link host for the page: the editor memoizes on it.
  const [handle] = useState(() =>
    createLinkHost({
      getSnapshot: () => index.snapshot(),
      purgedKeys: () => purged,
      openDocument: (id, { newTab, tocId }) => {
        setLastOpen(`${id} ${newTab ? "tab" : "current"}`);
        if (!newTab) openDoc.current(id, tocId);
      },
      goToHeadingHere: (tocId) =>
        editorRef.current ? goToHeading(editorRef.current, tocId) : false,
      openExternal: (href) => setExternal((list) => [...list, href]),
      announce: (message) => announce(message),
      onFollow: () => setFollows((n) => n + 1),
    }),
  );

  useEffect(() => {
    if (!mount.current) return;
    const editor = new Editor({
      element: mount.current,
      extensions: [
        Document,
        Paragraph,
        Text,
        TocHeading,
        Hyperlink.configure({ ...handle.host }),
      ],
      content: CONTENT["d-demo"],
    });
    editorRef.current = editor;
    // The extension draws icons once per link: redraw on index changes.
    const stop = index.subscribe(() => handle.refreshIcons(editor.view.dom));
    return () => {
      stop();
      editor.destroy();
      handle.dispose();
    };
  }, [handle, index]);

  openDoc.current = (id, tocId) => {
    const editor = editorRef.current;
    if (!editor) return;
    index.markOpened(id);
    setDocId(id);
    editor.commands.setContent(
      CONTENT[id] ?? {
        type: "doc",
        content: [heading(TOC.demoTitle, "Untitled")],
      },
    );
    if (tocId) {
      requestAnimationFrame(() =>
        openAtHeading(editor, tocId, goToHeading, announce),
      );
    }
  };

  return (
    <LibraryProvider
      index={index}
      onOpenDocument={(id, target) => {
        setLastOpen(`${id} ${target}`);
        if (target === "current") openDoc.current(id, null);
      }}
      activeDocumentId={docId}
    >
      <div className="h-app">
        <div
          className="h-tabs"
          role="toolbar"
          data-region=""
          aria-label="Open documents"
        >
          <output className="h-last" data-testid="last-open">
            {lastOpen}
          </output>
          <output className="h-last" data-testid="external">
            {external.join(" ")}
          </output>
          <output className="h-last" data-testid="follows">
            {follows}
          </output>
        </div>
        <div className="h-body-row">
          <div className="h-sidebar">
            <LibrarySidebar />
          </div>
          <main className="h-main" data-region="" aria-label="Document">
            <div ref={mount} className="h-doc h-editor" data-doc={docId} />
          </main>
        </div>
      </div>
    </LibraryProvider>
  );
}
