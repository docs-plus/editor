"use client";

import { useEffect, useRef, useState } from "react";
import {
  EditorContent,
  EditorContext,
  useEditor,
  type JSONContent,
} from "@tiptap/react";
import type * as Y from "yjs";

// --- Tiptap Core Extensions ---
import { StarterKit } from "@tiptap/starter-kit";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TextAlign } from "@tiptap/extension-text-align";
import { Typography } from "@tiptap/extension-typography";
import { Highlight } from "@tiptap/extension-highlight";
import { Subscript } from "@tiptap/extension-subscript";
import { Superscript } from "@tiptap/extension-superscript";
import { Selection } from "@tiptap/extensions";
import { Collaboration } from "@tiptap/extension-collaboration";
import { UniqueID } from "@tiptap/extension-unique-id";
import {
  TableOfContents,
  type TableOfContentData,
} from "@tiptap/extension-table-of-contents";

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button";
import { Spacer } from "@/components/tiptap-ui-primitive/spacer";
import {
  Toolbar,
  ToolbarGroup,
  ToolbarSeparator,
} from "@/components/tiptap-ui-primitive/toolbar";

// --- Tiptap Node ---
import { ImageUploadNode } from "@/components/tiptap-node/image-upload-node/image-upload-node-extension";
import { HorizontalRule } from "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node-extension";
import "@/components/tiptap-node/blockquote-node/blockquote-node.scss";
import "@/components/tiptap-node/code-block-node/code-block-node.scss";
import "@/components/tiptap-node/horizontal-rule-node/horizontal-rule-node.scss";
import "@/components/tiptap-node/list-node/list-node.scss";
import "@/components/tiptap-node/image-node/image-node.scss";
import "@/components/tiptap-node/heading-node/heading-node.scss";
import "@/components/tiptap-node/paragraph-node/paragraph-node.scss";

// --- Tiptap UI ---
import { HeadingDropdownMenu } from "@/components/tiptap-ui/heading-dropdown-menu";
import { ImageUploadButton } from "@/components/tiptap-ui/image-upload-button";
import { ListDropdownMenu } from "@/components/tiptap-ui/list-dropdown-menu";
import { BlockquoteButton } from "@/components/tiptap-ui/blockquote-button";
import { CodeBlockButton } from "@/components/tiptap-ui/code-block-button";
import {
  ColorHighlightPopover,
  ColorHighlightPopoverContent,
  ColorHighlightPopoverButton,
} from "@/components/tiptap-ui/color-highlight-popover";
import {
  LinkPopover,
  LinkContent,
  LinkButton,
} from "@/components/tiptap-ui/link-popover";
import { MarkButton } from "@/components/tiptap-ui/mark-button";
import { TextAlignButton } from "@/components/tiptap-ui/text-align-button";
import { UndoRedoButton } from "@/components/tiptap-ui/undo-redo-button";

// --- Icons ---
import {
  ArrowLeftIcon,
  HighlighterIcon,
  LinkIcon,
  PanelLeftIcon,
} from "@/components/tiptap-icons";

// --- Hooks ---
import { useIsBreakpoint } from "@/hooks/use-is-breakpoint";
import { useWindowSize } from "@/hooks/use-window-size";
import { useCursorVisibility } from "@/hooks/use-cursor-visibility";
import { useYjsDocument } from "@/hooks/use-yjs-document";
import { migrateLegacyLocalStorage } from "@/hooks/use-document-storage";

// --- Components ---
import { ThemeToggle } from "@/components/tiptap-templates/simple/theme-toggle";
import { TOCSidebar } from "@/components/toc-sidebar/toc-sidebar";

// --- Lib ---
import { handleImageUpload, MAX_FILE_SIZE } from "@/lib/tiptap-utils";

// --- Styles ---
import "@/components/tiptap-templates/simple/simple-editor.scss";

import defaultContent from "@/components/tiptap-templates/simple/data/content.json";

interface SimpleEditorProps {
  documentId?: string;
  onTitleChange?: (title: string) => void;
}

const MainToolbarContent = ({
  onHighlighterClick,
  onLinkClick,
  onTocToggle,
  isMobile,
  tocVisible,
}: {
  onHighlighterClick: () => void;
  onLinkClick: () => void;
  onTocToggle: () => void;
  isMobile: boolean;
  tocVisible: boolean;
}) => {
  return (
    <>
      {!isMobile && (
        <ToolbarGroup>
          <Button
            variant="ghost"
            onClick={onTocToggle}
            aria-label="Toggle outline"
            data-active-state={tocVisible ? "on" : "off"}
          >
            <PanelLeftIcon className="tiptap-button-icon" />
          </Button>
        </ToolbarGroup>
      )}

      <Spacer />

      <ToolbarGroup>
        <UndoRedoButton action="undo" />
        <UndoRedoButton action="redo" />
      </ToolbarGroup>

      <ToolbarSeparator />

      <ToolbarGroup>
        <HeadingDropdownMenu levels={[1, 2, 3, 4]} portal={isMobile} />
        <ListDropdownMenu
          types={["bulletList", "orderedList", "taskList"]}
          portal={isMobile}
        />
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
        <ImageUploadButton text="Add" />
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
      <Button variant="ghost" onClick={onBack}>
        <ArrowLeftIcon className="tiptap-button-icon" />
        {type === "highlighter" ? (
          <HighlighterIcon className="tiptap-button-icon" />
        ) : (
          <LinkIcon className="tiptap-button-icon" />
        )}
      </Button>
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
  migrationContent,
  onTitleChange,
}: {
  ydoc: Y.Doc;
  migrationContent: JSONContent | null;
  onTitleChange?: (title: string) => void;
}) {
  const isMobile = useIsBreakpoint();
  const { height } = useWindowSize();
  const [mobileView, setMobileView] = useState<"main" | "highlighter" | "link">(
    "main",
  );
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [toolbarHeight, setToolbarHeight] = useState(0);
  const [tocItems, setTocItems] = useState<TableOfContentData>([]);
  const [tocVisible, setTocVisible] = useState(true);

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
        horizontalRule: false,
        undoRedo: false,
        link: {
          openOnClick: false,
          enableClickSelection: true,
        },
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
    content: migrationContent ?? defaultContent,
    onUpdate: ({ editor: e }) => {
      if (!onTitleChange) return;
      const firstHeading = e
        .getJSON()
        .content?.find((node) => node.type === "heading");
      const title =
        firstHeading?.content
          ?.map((c) => ("text" in c ? (c.text as string) : ""))
          .join("") || "Untitled";
      onTitleChange(title);
    },
  });

  const rect = useCursorVisibility({
    editor,
    overlayHeight: toolbarHeight,
  });

  useEffect(() => {
    if (!isMobile && mobileView !== "main") {
      setMobileView("main");
    }
  }, [isMobile, mobileView]);

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
          {mobileView === "main" ? (
            <MainToolbarContent
              onHighlighterClick={() => setMobileView("highlighter")}
              onLinkClick={() => setMobileView("link")}
              onTocToggle={() => setTocVisible((v) => !v)}
              isMobile={isMobile}
              tocVisible={tocVisible}
            />
          ) : (
            <MobileToolbarContent
              type={mobileView === "highlighter" ? "highlighter" : "link"}
              onBack={() => setMobileView("main")}
            />
          )}
        </Toolbar>

        <div className="editor-with-toc">
          {tocVisible && !isMobile && (
            <TOCSidebar items={tocItems} editor={editor} />
          )}
          <EditorContent
            editor={editor}
            role="region"
            aria-label="Document editor"
            className="simple-editor-content"
          />
        </div>
      </EditorContext.Provider>
    </div>
  );
}

export function SimpleEditor({
  documentId,
  onTitleChange,
}: SimpleEditorProps = {}) {
  const docId = documentId ?? "default";
  const { ydoc, synced } = useYjsDocument(docId);
  const migrationChecked = useRef(false);
  const migrationRef = useRef<JSONContent | null>(null);

  if (synced && ydoc && !migrationChecked.current) {
    migrationChecked.current = true;
    const fragment = ydoc.getXmlFragment("default");
    if (fragment.length === 0) {
      migrationRef.current = migrateLegacyLocalStorage(docId);
    }
  }

  if (!synced || !ydoc) return <EditorSkeleton />;

  return (
    <SimpleEditorContent
      ydoc={ydoc}
      migrationContent={migrationRef.current}
      onTitleChange={onTitleChange}
    />
  );
}
