"use client";

import { isChangeOrigin } from "@tiptap/extension-collaboration";
import { EditorContent, EditorContext, useEditor } from "@tiptap/react";
import {
  type ComponentProps,
  Profiler,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type * as Y from "yjs";

import { Toolbar } from "@/components/ui/toolbar";
import {
  type HeadingFilterCallbackState,
  readFilterUrl,
} from "@/extensions/heading-filter";
import "@docs.plus/extension-hyperlink/styles.css";
import "@docs.plus/extension-hypermultimedia/styles.css";
import "@docs.plus/extension-mermaid/styles.css";
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
import {
  SkeletonDocument,
  SkeletonEditorBody,
} from "@/components/app-skeleton";
import { MainToolbarContent } from "@/components/document-editor/main-toolbar-content";
import { MobileToolbarContent } from "@/components/document-editor/mobile-toolbar-content";
import {
  countToolbarCommit,
  useToolbarOffForTests,
} from "@/components/document-editor/toolbar-test-hooks";
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
import {
  DOCUMENT_DELETED_REASON,
  DOCUMENT_TOO_LARGE_REASON,
  OFFLINE_BUDGET_REASON,
} from "@/lib/collab-session";

import { useDocumentEditorEffects } from "./use-document-editor-effects";
import { useMediaFileUpload } from "./use-media-file-upload";
import {
  type TocItemsStore,
  useTocItems,
  useTocItemsStore,
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
  /** Why edits are refused (size cap, deleted, offline budget), if they are. */
  rejectedReason: string | null;
  /** The server has confirmed this document; seeding waits for it. */
  serverSynced: boolean;
};

const REJECTION_NOTICES: Record<string, string> = {
  [DOCUMENT_TOO_LARGE_REASON]:
    "This document is over the size limit, so new changes can't be saved. Copy what you need into a new tab.",
  [DOCUMENT_DELETED_REASON]:
    "This document was deleted. You're seeing your device's last copy; copy what you need into a new tab.",
  [OFFLINE_BUDGET_REASON]:
    "You've made a lot of changes offline. Editing resumes when you're back online; nothing is lost.",
};

/** The outline sidebar, re-rendered on its own when the items change. */
function DocumentOutline({
  tocStore,
  ...props
}: Omit<ComponentProps<typeof TocSidebar>, "items"> & {
  tocStore: TocItemsStore;
}) {
  const items = useTocItems(tocStore);
  return <TocSidebar items={items} {...props} />;
}

const SCROLL_CLEARANCE = { top: 52, bottom: 8, left: 0, right: 0 };

const EDITOR_PROPS = {
  attributes: {
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
    "aria-label": "Main content area, start typing to enter text.",
    class: "document-editor",
  },
  // ProseMirror ignores CSS scroll-padding when it scrolls the caret, so keep
  // it clear of the sticky toolbar here: 52 = --tt-toolbar-height (44) + 8px air.
  scrollMargin: SCROLL_CLEARANCE,
  scrollThreshold: SCROLL_CLEARANCE,
};

function DocumentEditorContent({
  ydoc,
  provider,
  documentId,
  onTitleChange,
  initialContent,
  playgroundRegenerateTrigger,
  rejectedReason,
  serverSynced,
}: DocumentEditorContentProps) {
  const isMobile = useIsBreakpoint();
  const { height } = useWindowSize();
  const [mobileView, setMobileView] = useState<"main" | "highlighter">("main");
  const toolbarRef = useRef<HTMLDivElement>(null);
  const prevTitleRef = useRef("");
  const toolbarHeight = useToolbarHeight(toolbarRef);
  const tocStore = useTocItemsStore();

  const [tocVisible, setTocVisible] = useState(true);
  const [foldedIds, setFoldedIds] = useState<Set<string>>(new Set());
  const [filterState, setFilterState] = useState<HeadingFilterCallbackState>({
    matchedSectionIds: new Set(),
    totalSections: 0,
    slugs: [],
    mode: "or",
  });

  // `useEditor` compares its options on every render and, when any differ,
  // calls `editor.setOptions`: a full view update that also re-syncs the
  // whole document to Yjs. Keep every option stable between renders.
  const extensions = useMemo(
    () =>
      buildDocumentEditorExtensions({
        documentId,
        ydoc,
        provider,
        onFoldChange: setFoldedIds,
        onFilterChange: setFilterState,
        onTocUpdate: tocStore.set,
      }),
    [documentId, ydoc, provider, tocStore],
  );

  const editor = useEditor({
    immediatelyRender: false,
    editorProps: EDITOR_PROPS,
    extensions,
    content: initialContent ?? DEFAULT_EDITOR_CONTENT,
    onUpdate: ({ editor: e, transaction }) => {
      // Only this visitor's own edits rename the tab: renders from the
      // offline copy or from other collaborators must not write titles.
      if (!onTitleChange || isChangeOrigin(transaction)) return;
      const title = e.state.doc.firstChild?.textContent || "Untitled";
      if (title === prevTitleRef.current) return;
      prevTitleRef.current = title;
      onTitleChange(title);
    },
  });

  // Stop accepting input the server would drop.
  useEffect(() => {
    if (editor) editor.setEditable(rejectedReason === null);
  }, [editor, rejectedReason]);

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
    serverSynced,
    readInitialFilter: readFilterUrl,
    openFilterBar: headingFilter.openBar,
    toggleFilterBar: headingFilter.toggleBar,
    generatePlaygroundContent,
    defaultContent: DEFAULT_EDITOR_CONTENT,
  });

  useMediaFileUpload(editor);

  const rect = useCursorVisibility({
    editor,
    overlayHeight: toolbarHeight,
  });

  const effectiveMobileView = isMobile ? mobileView : "main";
  const toolbarOff = useToolbarOffForTests();

  return (
    <main className="document-editor-wrapper" data-nosnippet>
      <EditorContext.Provider value={{ editor }}>
        {!toolbarOff && (
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
            <Profiler id="toolbar" onRender={countToolbarCommit}>
              {effectiveMobileView === "main" ? (
                <MainToolbarContent
                  onHighlighterClick={() => setMobileView("highlighter")}
                  onTocToggle={() => setTocVisible((v) => !v)}
                  onFilterToggle={headingFilter.toggleBar}
                  isMobile={isMobile}
                  tocVisible={tocVisible}
                  filterActive={
                    headingFilter.isBarOpen || headingFilter.hasActiveFilters
                  }
                />
              ) : (
                <MobileToolbarContent onBack={() => setMobileView("main")} />
              )}
            </Profiler>
          </Toolbar>
        )}

        <FilterBar {...headingFilter} />

        <div className="editor-with-toc">
          {tocVisible && !isMobile && (
            <DocumentOutline
              tocStore={tocStore}
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
            // The editor opens editable from the device copy before the
            // server answers; this marks the first real server sync.
            data-server-synced={serverSynced}
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

        {rejectedReason && (
          <p role="alert" className="document-size-notice">
            {REJECTION_NOTICES[rejectedReason] ??
              "New changes to this document can't be saved."}
          </p>
        )}
        <CollabStatusGroup />
      </EditorContext.Provider>
    </main>
  );
}

export function DocumentEditor({
  documentId,
  onTitleChange,
  initialContent,
  playgroundRegenerateTrigger,
}: DocumentEditorProps = {}) {
  const docId = documentId ?? "default";
  const { ydoc, provider, synced, serverSynced, rejectedReason } =
    useYjsDocument(docId);

  if (!synced || !ydoc || !provider) {
    return (
      <SkeletonEditorBody>
        <SkeletonDocument />
      </SkeletonEditorBody>
    );
  }

  return (
    <DocumentEditorContent
      ydoc={ydoc}
      provider={provider}
      documentId={docId}
      onTitleChange={onTitleChange}
      initialContent={initialContent}
      playgroundRegenerateTrigger={playgroundRegenerateTrigger}
      rejectedReason={rejectedReason}
      serverSynced={serverSynced}
    />
  );
}
