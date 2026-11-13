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
  useSyncExternalStore,
} from "react";
import type * as Y from "yjs";

import { focusRovingItem, Toolbar } from "@/components/ui/toolbar";
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
import { DocumentNotice } from "@/components/document-editor/document-notice";
import { EditorSurfaces } from "@/components/smart-toolbar/editor-surfaces";
import { MainToolbarContent } from "@/components/document-editor/main-toolbar-content";
import { MobileToolbarContent } from "@/components/document-editor/mobile-toolbar-content";
import {
  countToolbarCommit,
  useToolbarOffForTests,
} from "@/components/document-editor/toolbar-test-hooks";
import { generatePlaygroundContent } from "@/components/document-editor/playground-scenarios";
import { onUiIntent } from "@/lib/editor-actions/ui-intents";
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
import { createSchemaGuard, type SchemaGuardState } from "@/lib/schema-guard";
import { EDITOR_FRAGMENT_NAME } from "@/lib/yjs-mark-migration";

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
  /** Why the server refuses edits (size, deleted, outdated…), if it does. */
  rejectedReason: string | null;
  /** The server has confirmed this document; seeding waits for it. */
  serverSynced: boolean;
};

const getServerGuardState = (): SchemaGuardState => "ok";

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

  // Contract §5.2: D1's `view.outline` intent calls `setOutlineOpen`; D2
  // swaps only this line for M6 memory, keeping the name and the
  // `(next: boolean | ((open: boolean) => boolean)) => void` signature.
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [foldedIds, setFoldedIds] = useState<Set<string>>(new Set());
  const [filterState, setFilterState] = useState<HeadingFilterCallbackState>({
    matchedSectionIds: new Set(),
    totalSections: 0,
    slugs: [],
    mode: "or",
  });

  // Freezes on unknown schema names, repairs misfits of known ones.
  const schemaGuard = useMemo(
    () => createSchemaGuard(ydoc.getXmlFragment(EDITOR_FRAGMENT_NAME)),
    [ydoc],
  );
  const guardState = useSyncExternalStore(
    schemaGuard.subscribe,
    schemaGuard.getState,
    getServerGuardState,
  );
  const reason = rejectedReason ?? (guardState === "ok" ? null : guardState);
  // The guard reads it when its repair timer fires, not when it binds.
  const canWriteRef = useRef(rejectedReason === null);
  useEffect(() => {
    canWriteRef.current = rejectedReason === null;
    // A repair deferred while refused (offline budget) runs now.
    if (rejectedReason === null) schemaGuard.onWritable();
  }, [rejectedReason, schemaGuard]);

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
        onInvalidContent: schemaGuard.onInvalidContent,
      }),
    [documentId, ydoc, provider, tocStore, schemaGuard],
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

  useEffect(() => {
    if (!editor) return;
    return schemaGuard.bind({
      editor,
      canWrite: () => canWriteRef.current,
    });
  }, [editor, schemaGuard]);

  // Stop accepting input the server would drop or the schema can't hold.
  useEffect(() => {
    if (editor) editor.setEditable(reason === null);
  }, [editor, reason]);

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

  // D1 (contract §5.2): shell intents from registry actions and Alt+F10.
  const toggleFilterBar = headingFilter.toggleBar;
  useEffect(() => {
    if (!editor) return;
    return onUiIntent(editor, (intent) => {
      switch (intent.type) {
        case "toolbar.focus": {
          const bubble = document.querySelector<HTMLElement>(
            '[data-smart-bubble][data-state="open"] [role="toolbar"]',
          );
          return focusRovingItem(bubble ?? toolbarRef.current);
        }
        case "outline.toggle":
          setOutlineOpen((open) => !open);
          return true;
        case "filter.toggle":
          toggleFilterBar();
          return true;
        default:
          return false;
      }
    });
  }, [editor, toggleFilterBar]);

  // Esc on a toolbar item returns to the document with its selection.
  // `view.focus()` restores the selection at once; Tiptap's `focus()` waits
  // a frame, and a keystroke typed before it would land in the toolbar.
  const returnToEditor = useCallback(() => {
    editor?.view.focus();
  }, [editor]);

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
            onEscape={returnToEditor}
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
                  onTocToggle={() => setOutlineOpen((open) => !open)}
                  onFilterToggle={headingFilter.toggleBar}
                  isMobile={isMobile}
                  tocVisible={outlineOpen}
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

        {!toolbarOff && <EditorSurfaces editor={editor} />}

        <FilterBar {...headingFilter} />

        <div className="editor-with-toc">
          {outlineOpen && !isMobile && (
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

        {reason && <DocumentNotice reason={reason} />}
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
      <>
        {/* Refused with no device copy: explain instead of loading forever. */}
        {rejectedReason && <DocumentNotice reason={rejectedReason} />}
        <SkeletonEditorBody>
          <SkeletonDocument />
        </SkeletonEditorBody>
      </>
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
