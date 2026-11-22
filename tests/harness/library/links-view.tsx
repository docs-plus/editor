/**
 * `?view=links`: the LK1 link host on a small Tiptap editor beside the files
 * sidebar, with every search-linking §4.6 state seeded in one document
 * ("Links demo"). Opening a document swaps the editor's content; outputs in
 * the tab row record what `navigate` did, so the spec can check that our
 * scheme never reaches the external opener. A toolbar button toggles
 * read-only. `&matrix=1` seeds the design-review matrix instead: every
 * state in a paragraph, a heading, a list, a table and styled text, plus
 * a Persian title in a left-to-right line.
 */
import "@docs.plus/extension-hyperlink/styles.css";
import "@/lib/links/doc-links.css";

import { Hyperlink } from "@docs.plus/extension-hyperlink";
import { Editor, type JSONContent, Mark } from "@tiptap/core";
import { Bold } from "@tiptap/extension-bold";
import { Document } from "@tiptap/extension-document";
import { Heading } from "@tiptap/extension-heading";
import { Highlight } from "@tiptap/extension-highlight";
import { BulletList, ListItem } from "@tiptap/extension-list";
import { Paragraph } from "@tiptap/extension-paragraph";
import {
  Table,
  TableCell,
  TableHeader,
  TableRow,
} from "@tiptap/extension-table";
import { Text } from "@tiptap/extension-text";
import { useEffect, useRef, useState } from "react";

import { LibraryProvider } from "@/components/library/library-context";
import { LibrarySidebar } from "@/components/library/library-sidebar";
import { announce } from "@/lib/announce";
import { docHref, hereHref } from "@/lib/links/doc-link";
import { createIconRefresher } from "@/lib/links/icon-refresh";
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
      line("Invalid", "A broken link", "tinydocy://local/doc/next"),
      line("Newer version", "From the future", "tinydocy:board/next"),
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

/** One link per state, for the matrix rows. */
const STATES: [string, string, string][] = [
  ["Resolves", "Q4 budget", docHref(KEY.budget)],
  ["In Trash", "Old plan", docHref(KEY.old)],
  ["Not available", "Someone else's", docHref(KEY.stranger)],
  ["Invalid", "A broken link", "tinydocy://local/doc/next"],
  ["Newer version", "From the future", "tinydocy:board/next"],
  ["Here", "Second section", hereHref(TOC.demoSecond)],
];

/** Coloured text inside a link, as the app's text colour mark renders it. */
const Tint = Mark.create({
  name: "tint",
  parseHTML: () => [{ tag: "span[data-tint]" }],
  renderHTML: () => [
    "span",
    { "data-tint": "", style: "color: var(--h-tint); font-size: 1.15em" },
    0,
  ],
});

const MATRIX: JSONContent = {
  type: "doc",
  content: [
    heading(TOC.demoTitle, "Links matrix"),
    ...STATES.map(([label, text, href]) => line(label, text, href)),
    ...STATES.map(([, text, href]) => ({
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "Heading: " }, link(text, href)],
    })),
    {
      type: "bulletList",
      content: STATES.map(([label, text, href]) => ({
        type: "listItem",
        content: [line(label, text, href)],
      })),
    },
    {
      type: "table",
      content: STATES.map(([label, text, href]) => ({
        type: "tableRow",
        content: [
          {
            type: "tableCell",
            content: [
              { type: "paragraph", content: [{ type: "text", text: label }] },
            ],
          },
          {
            type: "tableCell",
            content: [{ type: "paragraph", content: [link(text, href)] }],
          },
        ],
      })),
    },
    ...STATES.map(([label, text, href]) => ({
      type: "paragraph",
      content: [
        { type: "text", text: `Styled ${label}: ` },
        {
          type: "text",
          text,
          marks: [
            { type: "hyperlink", attrs: { href } },
            { type: "bold" },
            { type: "tint" },
          ],
        },
        { type: "text", text: " · " },
        {
          type: "text",
          text: "highlighted",
          marks: [
            { type: "hyperlink", attrs: { href } },
            // The app's yellow, its lowest-contrast highlight for links.
            { type: "highlight", attrs: { color: "var(--h-highlight)" } },
          ],
        },
      ],
    })),
    line("Persian in LTR", "گزارش سالانه ۱۴۰۳", docHref(KEY.budget)),
    heading(TOC.demoSecond, "Second section"),
  ],
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

const matrix = new URLSearchParams(location.search).get("matrix") === "1";
const FIRST = matrix ? MATRIX : CONTENT["d-demo"];

export function LinksHarness() {
  const [index] = useState(createLinksLibrary);
  const [docId, setDocId] = useState("d-demo");
  const docIdRef = useRef("d-demo");
  const [readOnly, setReadOnly] = useState(false);
  const [lastOpen, setLastOpen] = useState("");
  const [external, setExternal] = useState<string[]>([]);
  const [follows, setFollows] = useState(0);
  const mount = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Editor | null>(null);
  const openDoc = useRef<
    (id: string, tocId: string | null, title: string) => void
  >(() => {});

  // One link host for the page: the editor memoizes on it.
  const [handle] = useState(() =>
    createLinkHost({
      getSnapshot: () => index.snapshot(),
      purgedKeys: () => purged,
      openDocument: (id, { newTab, tocId, title }) => {
        setLastOpen(`${id} ${newTab ? "tab" : "current"}`);
        if (!newTab) openDoc.current(id, tocId, title);
      },
      getSource: () =>
        editorRef.current
          ? { docId: docIdRef.current, editor: editorRef.current }
          : null,
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
        Bold,
        Tint,
        Highlight.configure({ multicolor: true }),
        BulletList,
        ListItem,
        Table,
        TableRow,
        TableHeader,
        TableCell,
        Hyperlink.configure({ ...handle.host }),
      ],
      content: FIRST,
    });
    editorRef.current = editor;
    // The extension draws icons once per link: redraw, debounced, when a
    // key or Trash state changes.
    const refresher = createIconRefresher({
      subscribe: (listener) => index.subscribe(listener),
      getSnapshot: () => index.snapshot(),
      refresh: () => handle.refreshIcons(editor.view.dom),
    });
    return () => {
      refresher.dispose();
      editor.destroy();
      handle.dispose();
    };
  }, [handle, index]);

  useEffect(() => {
    editorRef.current?.setEditable(!readOnly);
  }, [readOnly]);

  openDoc.current = (id, tocId, title) => {
    const editor = editorRef.current;
    if (!editor) return;
    index.markOpened(id);
    setDocId(id);
    docIdRef.current = id;
    editor.commands.setContent(
      CONTENT[id] ?? {
        type: "doc",
        content: [heading(TOC.demoTitle, "Untitled")],
      },
    );
    if (tocId) {
      requestAnimationFrame(() => {
        void openAtHeading(editor, tocId, { title, goToHeading, announce });
      });
    }
  };

  return (
    <LibraryProvider
      index={index}
      onOpenDocument={(id, target) => {
        setLastOpen(`${id} ${target}`);
        if (target === "current") {
          const doc = index.snapshot().items.find((d) => d.id === id);
          openDoc.current(id, null, doc?.title ?? "");
        }
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
          <button
            type="button"
            className="h-tab"
            aria-pressed={readOnly}
            data-testid="readonly-toggle"
            onClick={() => setReadOnly((value) => !value)}
          >
            Read-only
          </button>
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
