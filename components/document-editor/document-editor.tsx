"use client";

import { EditorContent, EditorContext, useEditor } from "@tiptap/react";
import { useCallback, useRef, useState } from "react";
import type * as Y from "yjs";

import { Toolbar } from "@/components/ui/toolbar";
import {
  type HeadingFilterCallbackState,
  readFilterUrl,
} from "@/extensions/heading-filter";
import "@/components/tiptap-node/blockquote-node/blockquote-node.scss";
import "@/components/tiptap-node/code-block-node/code-block-node.scss";
import "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss";
import "@/components/tiptap-node/list-node/list-node.scss";
import "@/components/tiptap-node/image-node/image-node.scss";
import "@/extensions/heading-drag/heading-drag.scss";
import "@/extensions/heading-filter/heading-filter.scss";
import "@/extensions/heading-fold/heading-fold.scss";
import "@/extensions/shared/heading-node.scss";
import "@/components/tiptap-node/paragraph-node/paragraph-node.scss";
import "@/components/tiptap-node/table-node/table-node.scss";

import type { JSONContent } from "@tiptap/core";

import {
  buildDocumentEditorExtensions,
  DEFAULT_EDITOR_CONTENT,
} from "@/components/document-editor/document-editor-config";
import { EditorSkeleton } from "@/components/document-editor/editor-skeleton";
import { MainToolbarContent } from "@/components/document-editor/main-toolbar-content";
import { MobileToolbarContent } from "@/components/document-editor/mobile-toolbar-content";
import { generatePlaygroundContent } from "@/components/document-editor/playground-scenarios";
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

import { useDocumentEditorEffects } from "./use-document-editor-effects";
import {
  useDebouncedTocItems,
  useToolbarHeight,
} from "./use-document-editor-ui-state";
import "@/components/document-editor/document-editor.scss";

interface DocumentEditorProps {
  documentId?: string;
  onTitleChange?: (title: string) => void;
  initialContent?: JSONContent;
  playgroundRegenerateTrigger?: number;
}

type DocumentEditorContentProps = DocumentEditorProps & {
  ydoc: Y.Doc;
  provider: import("@hocuspocus/provider").HocuspocusProvider;
  documentId: string;
};

function DocumentEditorContent({
  ydoc,
  provider,
  documentId,
  onTitleChange,
  initialContent,
  playgroundRegenerateTrigger,
}: DocumentEditorContentProps) {
  const isMobile = useIsBreakpoint();
  const { height } = useWindowSize();
  const [mobileView, setMobileView] = useState<"main" | "highlighter" | "link">(
    "main",
  );
  const toolbarRef = useRef<HTMLDivElement>(null);
  const prevTitleRef = useRef("");
  const toolbarHeight = useToolbarHeight(toolbarRef);
  const { tocItems, updateTocItems } = useDebouncedTocItems();

  const [tocVisible, setTocVisible] = useState(true);
  const [foldedIds, setFoldedIds] = useState<Set<string>>(new Set());
  const [filterState, setFilterState] = useState<HeadingFilterCallbackState>({
    matchedSectionIds: new Set(),
    totalSections: 0,
    slugs: [],
    mode: "or",
  });

  const editor = useEditor({
    immediatelyRender: false,
    editorProps: {
      attributes: {
        autocomplete: "off",
        autocorrect: "off",
        autocapitalize: "off",
        "aria-label": "Main content area, start typing to enter text.",
        class: "document-editor",
      },
    },
    extensions: buildDocumentEditorExtensions({
      documentId,
      ydoc,
      provider,
      onFoldChange: setFoldedIds,
      onFilterChange: setFilterState,
      onTocUpdate: updateTocItems,
    }),
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

  const handleToggleFold = useCallback(
    (id: string) => editor?.commands.toggleFold(id),
    [editor],
  );

  useDocumentEditorEffects({
    editor,
    ydoc,
    documentId,
    playgroundRegenerateTrigger,
    readInitialFilter: readFilterUrl,
    openFilterBar: headingFilter.openBar,
    toggleFilterBar: headingFilter.toggleBar,
    generatePlaygroundContent,
    defaultContent: DEFAULT_EDITOR_CONTENT,
  });

  const rect = useCursorVisibility({
    editor,
    overlayHeight: toolbarHeight,
  });

  const effectiveMobileView = isMobile ? mobileView : "main";

  return (
    <div className="document-editor-wrapper">
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
            className="document-editor-content"
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

export function DocumentEditor({
  documentId,
  onTitleChange,
  initialContent,
  playgroundRegenerateTrigger,
}: DocumentEditorProps = {}) {
  const docId = documentId ?? "default";
  const { ydoc, provider, synced } = useYjsDocument(docId);

  if (!synced || !ydoc || !provider) return <EditorSkeleton />;

  return (
    <DocumentEditorContent
      ydoc={ydoc}
      provider={provider}
      documentId={docId}
      onTitleChange={onTitleChange}
      initialContent={initialContent}
      playgroundRegenerateTrigger={playgroundRegenerateTrigger}
    />
  );
}
