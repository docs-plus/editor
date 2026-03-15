"use client";

import { Collaboration } from "@tiptap/extension-collaboration";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import {
  type TableOfContentData,
  TableOfContents,
} from "@tiptap/extension-table-of-contents";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import { UniqueID } from "@tiptap/extension-unique-id";
import { Placeholder, Selection } from "@tiptap/extensions";
import { EditorContent, EditorContext, useEditor } from "@tiptap/react";
// --- Tiptap Core Extensions ---
import { StarterKit } from "@tiptap/starter-kit";
import { useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { TitleDocument } from "@/components/tiptap-node/document-node/document-node-extension";
import { HeadingDrag } from "@/components/tiptap-node/heading-node/heading-drag-extension";
import { HeadingFilter } from "@/components/tiptap-node/heading-node/heading-filter-extension";
import type { HeadingFilterCallbackState } from "@/components/tiptap-node/heading-node/heading-filter-plugin";
import { HeadingFold } from "@/components/tiptap-node/heading-node/heading-fold-extension";
import { HeadingScale } from "@/components/tiptap-node/heading-node/heading-scale-extension";
import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension";
// --- Tiptap Node ---
import { ImageUploadNode } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension";
// --- UI Primitives ---
import { Spacer } from "@/components/ui/spacer";
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/ui/toolbar";
import { ToolbarButton } from "@/components/ui/toolbar-button";
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

// --- Icons ---
import { readFilterUrl } from "@/components/tiptap-node/heading-node/helpers/filter-url";
// --- Lib ---
import {
  handleImageUpload,
  MAX_FILE_SIZE,
} from "@/components/tiptap-node/image-upload-node/upload-utils";
// --- Components ---
import { ThemeToggle } from "@/components/tiptap-templates/simple/theme-toggle";
import { BlockquoteButton } from "@/components/tiptap-ui/blockquote-button";
import { CodeBlockButton } from "@/components/tiptap-ui/code-block-button";
import {
  ColorHighlightPopover,
  ColorHighlightPopoverButton,
  ColorHighlightPopoverContent,
} from "@/components/tiptap-ui/color-highlight-popover";
// --- Tiptap UI ---
import { HeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu";
import {
  FilterBar,
  FilterToolbarButton,
  useHeadingFilter,
} from "@/components/tiptap-ui/heading-filter";
import { ImageUploadButton } from "@/components/tiptap-ui/image-upload-button";
import {
  LinkButton,
  LinkContent,
  LinkPopover,
} from "@/components/tiptap-ui/link-popover";
import { ListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu";
import { MarkButton } from "@/components/tiptap-ui/mark-button";
import { TextAlignButton } from "@/components/tiptap-ui/text-align-button";
import { UndoRedoButton } from "@/components/tiptap-ui/undo-redo-button";
import { TocSidebar } from "@/components/toc-sidebar/toc-sidebar";
import { useCursorVisibility } from "@/hooks/use-cursor-visibility";
// --- Hooks ---
import { useIsBreakpoint } from "@/hooks/use-is-breakpoint";
import { useWindowSize } from "@/hooks/use-window-size";
import { useYjsDocument } from "@/hooks/use-yjs-document";
import {
  ArrowLeftIcon,
  HighlighterIcon,
  LinkIcon,
  PanelLeftIcon,
} from "@/lib/icons";

// --- Styles ---
import "@/components/tiptap-templates/simple/simple-editor.scss";

import type { JSONContent } from "@tiptap/core";
import defaultContent from "@/components/tiptap-templates/simple/data/content.json";

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
  toolbar?: React.ReactNode;
}

const MainToolbarContent = ({
  onHighlighterClick,
  onLinkClick,
  onTocToggle,
  onFilterToggle,
  isMobile,
  tocVisible,
  filterActive,
}: {
  onHighlighterClick: () => void;
  onLinkClick: () => void;
  onTocToggle: () => void;
  onFilterToggle: () => void;
  isMobile: boolean;
  tocVisible: boolean;
  filterActive: boolean;
}) => {
  return (
    <>
      {!isMobile && (
        <ToolbarGroup>
          <ToolbarButton
            onClick={onTocToggle}
            aria-label="Toggle outline"
            tooltip="Toggle outline"
            isActive={tocVisible}
          >
            <PanelLeftIcon />
          </ToolbarButton>
          <FilterToolbarButton
            onClick={onFilterToggle}
            isActive={filterActive}
          />
        </ToolbarGroup>
      )}

      <Spacer />

      <ToolbarGroup>
        <UndoRedoButton action="undo" />
        <UndoRedoButton action="redo" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <HeadingDropdownMenu levels={[1, 2, 3, 4, 5, 6]} />
        <ListDropdownMenu types={["bulletList", "orderedList", "taskList"]} />
        <BlockquoteButton />
        <CodeBlockButton />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="bold" />
        <MarkButton type="italic" />
        <MarkButton type="strike" />
        <MarkButton type="code" />
        <MarkButton type="underline" />
        {!isMobile ? (
          <ColorHighlightPopover />
        ) : (
          <ColorHighlightPopoverButton onClick={onHighlighterClick} />
        )}
        {!isMobile ? <LinkPopover /> : <LinkButton onClick={onLinkClick} />}
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <MarkButton type="superscript" />
        <MarkButton type="subscript" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <TextAlignButton align="left" />
        <TextAlignButton align="center" />
        <TextAlignButton align="right" />
        <TextAlignButton align="justify" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <ImageUploadButton text="Add" size="sm" />
      </ToolbarGroup>

      <Spacer />

      {isMobile && <ToolbarSeparator />}

      <ToolbarGroup>
        <ThemeToggle />
      </ToolbarGroup>
    </>
  );
};

const MobileToolbarContent = ({
  type,
  onBack,
}: {
  type: "highlighter" | "link";
  onBack: () => void;
}) => (
  <>
    <ToolbarGroup>
      <ToolbarButton onClick={onBack} size="sm">
        <ArrowLeftIcon />
        {type === "highlighter" ? <HighlighterIcon /> : <LinkIcon />}
      </ToolbarButton>
    </ToolbarGroup>

    <ToolbarSeparator />

    {type === "highlighter" ? (
      <ColorHighlightPopoverContent />
    ) : (
      <LinkContent />
    )}
  </>
);

function EditorSkeleton() {
  return (
    <div className="simple-editor-wrapper">
      <div className="editor-skeleton">
        <div className="editor-skeleton-toolbar" />
        <div className="editor-skeleton-content">
          <div className="editor-skeleton-line editor-skeleton-line--wide" />
          <div className="editor-skeleton-line editor-skeleton-line--medium" />
          <div className="editor-skeleton-line editor-skeleton-line--narrow" />
        </div>
      </div>
    </div>
  );
}

function SimpleEditorContent({
  ydoc,
  documentId,
  onTitleChange,
  initialContent,
  toolbar: extraToolbar,
}: {
  ydoc: Y.Doc;
  documentId: string;
  onTitleChange?: (title: string) => void;
  initialContent?: JSONContent;
  toolbar?: React.ReactNode;
}) {
  const isMobile = useIsBreakpoint();
  const { height } = useWindowSize();
  const [mobileView, setMobileView] = useState<"main" | "highlighter" | "link">(
    "main",
  );
  const toolbarRef = useRef<HTMLDivElement>(null);
  const prevTitleRef = useRef("");
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [tocItems, setTocItems] = useState<TableOfContentData>([]);
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
        link: {
          openOnClick: false,
          enableClickSelection: true,
        },
      }),
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
        showOnlyCurrent: false,
        includeChildren: true,
        placeholder: ({ editor, node, pos, hasAnchor }) => {
          if (node.type.name === "heading" && pos === 0) {
            return "Enter document name";
          }
          if (!hasAnchor) return "";
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
        onUpdate: (anchors) => setTocItems(anchors),
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
    ],
    content: initialContent ?? defaultContent,
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
      (window as Record<string, unknown>).__tiptap_editor = editor;
    }
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const initial = readFilterUrl();
    if (initial && initial.slugs.length > 0) {
      editor.commands.applyFilter(initial.slugs, initial.mode);
      headingFilter.openBar();
    }
  }, [editor, headingFilter.openBar]);

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
              type={
                effectiveMobileView === "highlighter" ? "highlighter" : "link"
              }
              onBack={() => setMobileView("main")}
            />
          )}
        </Toolbar>

        {extraToolbar}

        <FilterBar {...headingFilter} />

        <div className="editor-with-toc">
          {tocVisible && !isMobile && (
            <TocSidebar
              items={tocItems}
              editor={editor}
              foldedIds={foldedIds}
              onToggleFold={(id) => editor?.commands.toggleFold(id)}
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
              <div className="filter-empty-state">
                <p>No sections match your filter.</p>
                <button
                  type="button"
                  className="filter-empty-state-clear"
                  onClick={headingFilter.clearAllFilters}
                >
                  Clear filters
                </button>
              </div>
            )}
        </div>
      </EditorContext.Provider>
    </div>
  );
}

export function SimpleEditor({
  documentId,
  onTitleChange,
  initialContent,
  toolbar,
}: SimpleEditorProps = {}) {
  const docId = documentId ?? "default";
  const { ydoc, synced } = useYjsDocument(docId);

  if (!synced || !ydoc) return <EditorSkeleton />;

  return (
    <SimpleEditorContent
      ydoc={ydoc}
      documentId={docId}
      onTitleChange={onTitleChange}
      initialContent={initialContent}
      toolbar={toolbar}
    />
  );
}
