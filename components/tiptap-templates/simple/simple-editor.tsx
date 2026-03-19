"use client";

import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Collaboration } from "@tiptap/extension-collaboration";
import { CollaborationCaret } from "@tiptap/extension-collaboration-caret";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { TableKit } from "@tiptap/extension-table";
import {
  type TableOfContentData,
  TableOfContents,
} from "@tiptap/extension-table-of-contents";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import { UniqueID } from "@tiptap/extension-unique-id";
import { Placeholder, Selection } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import { EditorContent, EditorContext, useEditor } from "@tiptap/react";
import { StarterKit } from "@tiptap/starter-kit";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";

import { TitleDocument } from "@/components/tiptap-node/document-node/document-node-extension";
import { HeadingDrag } from "@/components/tiptap-node/heading-node/heading-drag-extension";
import { HeadingFilter } from "@/components/tiptap-node/heading-node/heading-filter-extension";
import type { HeadingFilterCallbackState } from "@/components/tiptap-node/heading-node/heading-filter-plugin";
import { HeadingFold } from "@/components/tiptap-node/heading-node/heading-fold-extension";
import { HeadingScale } from "@/components/tiptap-node/heading-node/heading-scale-extension";
import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension";
import { ImageUploadNode } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension";
import { Toolbar } from "@/components/ui/toolbar";
import { lowlight } from "@/lib/lowlight";
import "@/components/tiptap-node/blockquote-node/blockquote-node.scss";
import "@/components/tiptap-node/code-block-node/code-block-node.scss";
import "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss";
import "@/components/tiptap-node/list-node/list-node.scss";
import "@/components/tiptap-node/image-node/image-node.scss";
import "@/components/tiptap-node/heading-node/heading-drag.scss";
import "@/components/tiptap-node/heading-node/heading-filter.scss";
import "@/components/tiptap-node/heading-node/heading-fold.scss";
import "@/components/tiptap-node/heading-node/heading-node.scss";
import "@/components/tiptap-node/paragraph-node/paragraph-node.scss";
import "@/components/tiptap-node/table-node/table-node.scss";

import { readFilterUrl } from "@/components/tiptap-node/heading-node/helpers/filter-url";
import {
  handleImageUpload,
  MAX_FILE_SIZE,
} from "@/components/tiptap-node/image-upload-node/upload-utils";
import { EditorSkeleton } from "@/components/tiptap-templates/simple/editor-skeleton";
import { MainToolbarContent } from "@/components/tiptap-templates/simple/main-toolbar-content";
import { MobileToolbarContent } from "@/components/tiptap-templates/simple/mobile-toolbar-content";
import { generatePlaygroundContent } from "@/components/tiptap-templates/simple/playground-scenarios";
import {
  FilterBar,
  useHeadingFilter,
} from "@/components/tiptap-ui/heading-filter";
import { CollabStatusGroup } from "@/components/tiptap-ui/user-identity-button";
import { TocSidebar } from "@/components/toc-sidebar/toc-sidebar";
import { useCursorVisibility } from "@/hooks/use-cursor-visibility";
import { useIsBreakpoint } from "@/hooks/use-is-breakpoint";
import { useWindowSize } from "@/hooks/use-window-size";
import { useYjsDocument } from "@/hooks/use-yjs-document";
import { PLAYGROUND_ID } from "@/lib/constants";
import { getUserIdentity } from "@/lib/user-identity";
import "@/components/tiptap-templates/simple/simple-editor.scss";

import type { JSONContent } from "@tiptap/core";

/** Minimal valid doc per TitleDocument schema (H1 + body). */
const DEFAULT_EDITOR_CONTENT = {
  type: "doc",
  content: [{ type: "heading", attrs: { level: 1 } }, { type: "paragraph" }],
} satisfies JSONContent;

/**
 * Placeholder text per empty text-block node type. Container nodes (blockquote,
 * listItem, taskItem) can't be empty due to schema constraints — their inner
 * paragraphs receive context-aware placeholders via PARENT_PLACEHOLDER instead.
 * Leaf/atom nodes (image, horizontalRule) have no text content. Title heading
 * (pos 0) is handled separately in the Placeholder callback.
 */
const PLACEHOLDER_TEXT: Record<string, string> = {
  heading: "Heading",
  paragraph: "Type something...",
  codeBlock: "Write code...",
};

/** Overrides paragraph placeholder when nested inside a container node. */
const PARENT_PLACEHOLDER: Record<string, string> = {
  listItem: "List",
  taskItem: "To-do",
  blockquote: "Quote",
};

interface SimpleEditorProps {
  documentId?: string;
  onTitleChange?: (title: string) => void;
  initialContent?: JSONContent;
  playgroundRegenerateTrigger?: number;
}

type SimpleEditorContentProps = SimpleEditorProps & {
  ydoc: Y.Doc;
  provider: import("@hocuspocus/provider").HocuspocusProvider;
  documentId: string;
};

function SimpleEditorContent({
  ydoc,
  provider,
  documentId,
  onTitleChange,
  initialContent,
  playgroundRegenerateTrigger,
}: SimpleEditorContentProps) {
  const isMobile = useIsBreakpoint();
  const { height } = useWindowSize();
  const [mobileView, setMobileView] = useState<"main" | "highlighter" | "link">(
    "main",
  );
  const toolbarRef = useRef<HTMLDivElement>(null);
  const prevTitleRef = useRef("");
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [tocItems, setTocItems] = useState<TableOfContentData>([]);
  const tocPendingRef = useRef(false);
  const tocLatestRef = useRef<TableOfContentData>([]);
  const debouncedSetTocItems = useCallback((items: TableOfContentData) => {
    tocLatestRef.current = items;
    if (tocPendingRef.current) return;
    tocPendingRef.current = true;
    queueMicrotask(() => {
      tocPendingRef.current = false;
      setTocItems(tocLatestRef.current);
    });
  }, []);

  const [tocVisible, setTocVisible] = useState(true);
  const [foldedIds, setFoldedIds] = useState<Set<string>>(new Set());
  const [filterState, setFilterState] = useState<HeadingFilterCallbackState>({
    matchedSectionIds: new Set(),
    totalSections: 0,
    slugs: [],
    mode: "or",
  });

  useEffect(() => {
    if (!toolbarRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setToolbarHeight(entry.contentRect.height);
      }
    });
    ro.observe(toolbarRef.current);
    return () => ro.disconnect();
  }, []);

  const editor = useEditor({
    immediatelyRender: false,
    editorProps: {
      attributes: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        "aria-label": "Main content area, start typing to enter text.",
        class: "simple-editor",
      },
    },
    extensions: [
      StarterKit.configure({
        document: false,
        horizontalRule: false,
        undoRedo: false,
        codeBlock: false,
        link: {
          openOnClick: false,
          enableClickSelection: true,
        },
      }),
      CodeBlockLowlight.configure({ lowlight }),
      TitleDocument,
      HeadingScale,
      HeadingDrag,
      HeadingFold.configure({
        documentId,
        onFoldChange: setFoldedIds,
      }),
      HeadingFilter.configure({
        onFilterChange: setFilterState,
      }),
      Collaboration.configure({
        document: ydoc,
      }),
      CollaborationCaret.configure({
        provider,
      }),
      HorizontalRule,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Highlight.configure({ multicolor: true }),
      Image,
      Typography,
      Superscript,
      Subscript,
      Selection,
      Placeholder.configure({
        showOnlyCurrent: true,
        includeChildren: true,
        placeholder: ({ editor, node, pos }) => {
          if (node.type.name === "heading" && pos === 0) {
            return "Enter document name";
          }
          if (node.type.name === "paragraph") {
            const parent = editor.state.doc.resolve(pos).parent.type.name;
            if (parent in PARENT_PLACEHOLDER) return PARENT_PLACEHOLDER[parent];
          }
          return PLACEHOLDER_TEXT[node.type.name] ?? "";
        },
      }),
      UniqueID.configure({
        types: ["heading"],
      }),
      TableOfContents.configure({
        onUpdate: (anchors) => debouncedSetTocItems(anchors),
        scrollParent: () =>
          (document.querySelector(".simple-editor-wrapper") as HTMLElement) ??
          window,
      }),
      ImageUploadNode.configure({
        accept: "image/*",
        maxSize: MAX_FILE_SIZE,
        limit: 3,
        upload: handleImageUpload,
        onError: (error) => console.error("Upload failed:", error),
      }),
      TableKit.configure({ table: { resizable: true } }),
      Markdown,
    ],
    content: initialContent ?? DEFAULT_EDITOR_CONTENT,
    onUpdate: ({ editor: e }) => {
      if (!onTitleChange) return;
      const title = e.state.doc.firstChild?.textContent || "Untitled";
      if (title === prevTitleRef.current) return;
      prevTitleRef.current = title;
      onTitleChange(title);
    },
  });

  const headingFilter = useHeadingFilter({ editor, filterState });

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" && editor) {
      window.__tiptap_editor = editor;
      return () => {
        delete window.__tiptap_editor;
      };
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    editor.commands.updateUser(getUserIdentity());
  }, [editor]);

  const handleToggleFold = useCallback(
    (id: string) => editor?.commands.toggleFold(id),
    [editor],
  );

  useEffect(() => {
    if (!editor) return;
    const initial = readFilterUrl();
    if (initial && initial.slugs.length > 0) {
      editor.commands.applyFilter(initial.slugs, initial.mode);
      headingFilter.openBar();
    }
  }, [editor, headingFilter.openBar]);

  useEffect(() => {
    if (
      !editor ||
      documentId !== PLAYGROUND_ID ||
      !playgroundRegenerateTrigger ||
      playgroundRegenerateTrigger <= 0
    )
      return;
    editor.commands.setContent(generatePlaygroundContent());
  }, [editor, documentId, playgroundRegenerateTrigger]);

  useEffect(() => {
    if (!editor || !ydoc) return;
    const fragment = ydoc.getXmlFragment("default");
    if (fragment.length > 0) return;
    const content =
      documentId === PLAYGROUND_ID
        ? generatePlaygroundContent()
        : DEFAULT_EDITOR_CONTENT;
    editor.commands.setContent(content);
  }, [editor, ydoc, documentId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === "f") {
        e.preventDefault();
        headingFilter.toggleBar();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [headingFilter.toggleBar]);

  const rect = useCursorVisibility({
    editor,
    overlayHeight: toolbarHeight,
  });

  const effectiveMobileView = isMobile ? mobileView : "main";

  return (
    <div className="simple-editor-wrapper">
      <EditorContext.Provider value={{ editor }}>
        <Toolbar
          ref={toolbarRef}
          style={{
            ...(isMobile
              ? {
                  bottom: `calc(100% - ${height - rect.y}px)`,
                }
              : {}),
          }}
        >
          {effectiveMobileView === "main" ? (
            <MainToolbarContent
              onHighlighterClick={() => setMobileView("highlighter")}
              onLinkClick={() => setMobileView("link")}
              onTocToggle={() => setTocVisible((v) => !v)}
              onFilterToggle={headingFilter.toggleBar}
              isMobile={isMobile}
              tocVisible={tocVisible}
              filterActive={
                headingFilter.isBarOpen || headingFilter.hasActiveFilters
              }
            />
          ) : (
            <MobileToolbarContent
              type={effectiveMobileView}
              onBack={() => setMobileView("main")}
            />
          )}
        </Toolbar>

        <FilterBar {...headingFilter} />

        <div className="editor-with-toc">
          {tocVisible && !isMobile && (
            <TocSidebar
              items={tocItems}
              editor={editor}
              foldedIds={foldedIds}
              onToggleFold={handleToggleFold}
              filteredIds={
                headingFilter.hasActiveFilters
                  ? filterState.matchedSectionIds
                  : undefined
              }
              previewMatchIds={
                headingFilter.query.trim().length > 0
                  ? filterState.matchedSectionIds
                  : undefined
              }
            />
          )}
          <EditorContent
            editor={editor}
            role="region"
            aria-label="Document editor"
            className="simple-editor-content"
          />
          {headingFilter.hasActiveFilters &&
            filterState.matchedSectionIds.size === 0 && (
              <div className="flex flex-col items-center justify-center gap-3 py-12 px-4 text-muted-foreground text-sm text-center">
                <p className="m-0">No sections match your filter.</p>
                <button
                  type="button"
                  className="px-3 py-1.5 border border-border rounded-md bg-transparent text-foreground text-[0.8125rem] cursor-pointer transition-colors hover:bg-muted"
                  onClick={headingFilter.clearAllFilters}
                >
                  Clear filters
                </button>
              </div>
            )}
        </div>

        <CollabStatusGroup provider={provider} />
      </EditorContext.Provider>
    </div>
  );
}

export function SimpleEditor({
  documentId,
  onTitleChange,
  initialContent,
  playgroundRegenerateTrigger,
}: SimpleEditorProps = {}) {
  const docId = documentId ?? "default";
  const { ydoc, provider, synced } = useYjsDocument(docId);

  if (!synced || !ydoc || !provider) return <EditorSkeleton />;

  return (
    <SimpleEditorContent
      ydoc={ydoc}
      provider={provider}
      documentId={docId}
      onTitleChange={onTitleChange}
      initialContent={initialContent}
      playgroundRegenerateTrigger={playgroundRegenerateTrigger}
    />
  );
}
