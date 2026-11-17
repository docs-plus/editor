"use client";

/**
 * The files sidebar (plan §5.1, UX §4.5 and §8.1): Search (Quick Open),
 * an optional host row such as the Playground, Recent (5 inline), Pinned
 * (after the first pin), the Library tree, and Trash in the footer. It is
 * the `Files` navigation region for F6. Shared by desktop and the web
 * library (D3); the host wraps it in a `LibraryProvider`.
 */
import "./library.css";

import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useMemo,
  useSyncExternalStore,
} from "react";

import { Button } from "@/components/ui/button";
import {
  ClockIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderPlusIcon,
  LibraryIcon,
  PinIcon,
  SearchIcon,
  TrashIcon,
} from "@/lib/icons";
import {
  isContextMenuKey,
  isTrashKey,
  isUndoKey,
  openTarget,
} from "@/lib/library/library-keys";
import { entryTitle, pinnedEntries } from "@/lib/library/tree-rows";
import type { DocumentEntry } from "@/lib/platform/document-index";
import { isMac } from "@/lib/shortcuts";

import { type LibraryPlace, useLibrary } from "./library-context";
import {
  type DropTarget,
  useLibraryDropZone,
  useLibraryRowDnd,
} from "./library-dnd";
import { LibraryTree } from "./library-tree";

export const SIDEBAR_RECENT = 5;

const noSubscribe = () => () => {};
/** ⌘ or Ctrl, decided after hydration (the server says Ctrl). */
function useIsMac(): boolean {
  return useSyncExternalStore(noSubscribe, isMac, () => false);
}

function SectionRow({
  icon,
  label,
  place,
  current,
  count,
  drop,
}: {
  icon: ReactNode;
  label: string;
  place: LibraryPlace;
  current: boolean;
  count?: number;
  drop?: DropTarget;
}) {
  const { actions } = useLibrary();
  return (
    <SectionButton
      drop={drop}
      current={current}
      onClick={(event) => actions.openPlace(place, openTarget(event, isMac()))}
    >
      {icon}
      <span className="lib-label">{label}</span>
      {count !== undefined ? (
        <span className="lib-count">
          <span className="sr-only">, </span>
          {count}
          <span className="sr-only"> {count === 1 ? "item" : "items"}</span>
        </span>
      ) : null}
    </SectionButton>
  );
}

function SectionButton({
  drop,
  current,
  onClick,
  children,
}: {
  drop?: DropTarget;
  current: boolean;
  onClick: (event: MouseEvent) => void;
  children: ReactNode;
}) {
  const zone = useLibraryDropZone(drop);
  return (
    <button
      ref={zone.ref}
      type="button"
      className="lib-item"
      aria-current={current ? "page" : undefined}
      data-drop={zone.highlight ?? undefined}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function InlineDocRow({
  doc,
  list,
}: {
  doc: DocumentEntry;
  list: "recent" | "pinned";
}) {
  const { actions, activeDocumentId } = useLibrary();
  const title = entryTitle(doc);
  const pinned = list === "pinned";
  const dnd = useLibraryRowDnd({
    dragId: `${list}:${doc.id}`,
    payload: {
      items: [{ kind: "doc", id: doc.id }],
      label: title,
      fromPinned: pinned,
    },
    target: pinned ? { kind: "pin", id: doc.id } : undefined,
  });
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const mac = isMac();
    const item = { kind: "doc" as const, id: doc.id };
    if (isContextMenuKey(event)) {
      event.preventDefault();
      actions.openMenu(item, event.currentTarget, pinned);
    } else if (isTrashKey(event, mac)) {
      event.preventDefault();
      actions.trash([item]);
    } else if (isUndoKey(event, mac)) {
      event.preventDefault();
      actions.undo();
    } else if (event.key === "Enter" && openTarget(event, mac) !== "current") {
      event.preventDefault();
      actions.open(doc.id, openTarget(event, mac));
    }
  };
  return (
    <li>
      <button
        ref={dnd.ref}
        type="button"
        className="lib-item lib-item-sub"
        aria-current={doc.id === activeDocumentId ? "page" : undefined}
        data-dragging={dnd.isDragging ? "" : undefined}
        title={title}
        onClick={(event) => actions.open(doc.id, openTarget(event, isMac()))}
        onAuxClick={(event) => {
          if (event.button === 1) actions.open(doc.id, "tab");
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          actions.openMenu(
            { kind: "doc", id: doc.id },
            { x: event.clientX, y: event.clientY },
            pinned,
          );
        }}
        onKeyDown={onKeyDown}
        {...dnd.listeners}
      >
        <FileTextIcon aria-hidden="true" />
        <span className="lib-label">
          <bdi dir="auto">{title}</bdi>
        </span>
      </button>
    </li>
  );
}

export interface LibrarySidebarProps {
  /** Rows the host adds under Search, such as the Playground. */
  header?: ReactNode;
  /** The list shown in the main area, for `aria-current`. */
  currentPlace?: LibraryPlace | null;
  /** Rows the host adds to the footer, such as a health warning. */
  footer?: ReactNode;
}

export function LibrarySidebar({
  header,
  currentPlace = null,
  footer,
}: LibrarySidebarProps) {
  const { snapshot, actions } = useLibrary();
  const mac = useIsMac();
  const recent = useMemo(
    () =>
      snapshot.items
        .filter((doc) => doc.openedAt !== undefined)
        .sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))
        .slice(0, SIDEBAR_RECENT),
    [snapshot],
  );
  const pinned = useMemo(() => pinnedEntries(snapshot), [snapshot]);
  const libraryZone = useLibraryDropZone({ kind: "root" });
  const is = (kind: LibraryPlace["kind"]) => currentPlace?.kind === kind;

  return (
    <nav className="lib-sidebar" aria-label="Files" data-region="">
      <div className="lib-scroll">
        <button
          type="button"
          className="lib-search"
          aria-keyshortcuts={mac ? "Meta+O" : "Control+O"}
          onClick={() => actions.openQuickOpen()}
        >
          <SearchIcon aria-hidden="true" />
          <span className="lib-search-label">Search by title</span>
          <kbd dir="ltr">{mac ? "⌘O" : "Ctrl+O"}</kbd>
        </button>
        {header}
        {header ? <div className="lib-sep" role="separator" /> : null}

        <SectionRow
          icon={<ClockIcon aria-hidden="true" />}
          label="Recent"
          place={{ kind: "recent" }}
          current={is("recent")}
        />
        {recent.length > 0 ? (
          <ul className="lib-sub" aria-label="Recent">
            {recent.map((doc) => (
              <InlineDocRow key={doc.id} doc={doc} list="recent" />
            ))}
          </ul>
        ) : null}

        {pinned.length > 0 ? (
          <>
            <SectionRow
              icon={<PinIcon aria-hidden="true" />}
              label="Pinned"
              place={{ kind: "pinned" }}
              current={is("pinned")}
              drop={{ kind: "pinned" }}
            />
            <ul className="lib-sub" aria-label="Pinned">
              {pinned.map((doc) => (
                <InlineDocRow key={doc.id} doc={doc} list="pinned" />
              ))}
            </ul>
          </>
        ) : null}

        <div className="lib-sep" role="separator" />
        <div
          ref={libraryZone.ref}
          className="lib-head"
          data-drop={libraryZone.highlight ?? undefined}
        >
          <button
            type="button"
            className="lib-item"
            aria-current={is("library") ? "page" : undefined}
            onClick={(event) =>
              actions.openPlace({ kind: "library" }, openTarget(event, isMac()))
            }
          >
            <LibraryIcon aria-hidden="true" />
            <span className="lib-label">Library</span>
          </button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="New Folder"
            title={`New Folder (${mac ? "⇧⌘N" : "Ctrl+Shift+N"})`}
            onClick={() => actions.createFolder(null)}
          >
            <FolderPlusIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-xs"
            aria-label="New Document"
            title={`New Document (${mac ? "⌘N" : "Ctrl+N"})`}
            onClick={() => actions.createDocument(null)}
          >
            <FilePlusIcon aria-hidden="true" />
          </Button>
        </div>
        <LibraryTree />
      </div>
      <div className="lib-foot">
        <SectionRow
          icon={<TrashIcon aria-hidden="true" />}
          label="Trash"
          place={{ kind: "trash" }}
          current={is("trash")}
          count={snapshot.trashCount}
          drop={{ kind: "trash" }}
        />
        {footer}
      </div>
    </nav>
  );
}
