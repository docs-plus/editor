"use client";

/**
 * The library's per-window state and file operations, shared by the files
 * sidebar, Quick Open and Move to… (desktop and the web library, D3). The
 * host passes a `LibraryIndex` and says what opening means; everything
 * else (expanded folders, rename, the undo stack, recent Move to…
 * destinations, drag and drop) lives here, per window.
 */
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { announce } from "@/lib/announce";
import { createFileUndoStack } from "@/lib/library/file-undo";
import {
  canCreateFolderIn,
  folderPath,
  indexFolders,
  MAX_FOLDER_DEPTH,
  moveRefusalMessage,
} from "@/lib/library/folder-rules";
import type { OpenTarget } from "@/lib/library/library-keys";
import {
  entryTitle,
  itemKey,
  parseItemKey,
  pinnedEntries,
} from "@/lib/library/tree-rows";
import type {
  LibraryIndex,
  LibraryIndexSnapshot,
  LibraryItemRef,
} from "@/lib/platform/document-index";

import { ItemMenu, type MenuAnchor } from "./item-menu";
import { LibraryDnd } from "./library-dnd";
import { MoveToDialog } from "./move-to-dialog";
import { QuickOpen } from "./quick-open";

/** A list the host shows in the main area (UX §4.1). */
export type LibraryPlace =
  | { kind: "recent" }
  | { kind: "pinned" }
  | { kind: "library" }
  | { kind: "trash" }
  | { kind: "folder"; id: string };

export interface LibraryHostProps {
  index: LibraryIndex;
  /** Opens a document in this tab, a new tab or a new window. */
  onOpenDocument: (id: string, target: OpenTarget) => void;
  /** Shows a list (Recent, Pinned, a folder, Trash) in the main area. */
  onOpenPlace?: (place: LibraryPlace, target: OpenTarget) => void;
  /** The document open in this tab, if any (`aria-current`). */
  activeDocumentId?: string | null;
  children?: ReactNode;
}

export const RECENT_DESTINATIONS = 3;
const NEW_FOLDER = "New Folder";

interface MenuState {
  /** A fresh menu instance per open. */
  serial: number;
  item: LibraryItemRef;
  anchor: MenuAnchor;
  /** Where focus goes when the menu closes. */
  returnFocus: HTMLElement | null;
  /** The menu was opened on a pinned row. */
  pinned: boolean;
}

interface FocusRequest {
  key: string;
  /** Changes on every request, so the same key can be asked twice. */
  serial: number;
}

export interface LibraryActions {
  open(id: string, target?: OpenTarget): void;
  openPlace(place: LibraryPlace, target?: OpenTarget): void;
  createDocument(folderId: string | null): void;
  /** Creates "New Folder" in `parentId` and starts renaming it. */
  createFolder(parentId: string | null): void;
  rename(item: LibraryItemRef, name: string): void;
  trash(items: readonly LibraryItemRef[], focusAfter?: string | null): void;
  /** Moves; announces a refusal. True when it moved. */
  move(items: readonly LibraryItemRef[], folderId: string | null): boolean;
  pin(id: string): void;
  unpin(id: string): void;
  /** Moves a pinned document to `toIndex` among the pinned. */
  movePin(id: string, toIndex: number): void;
  undo(): void;
  toggleFolder(id: string, open?: boolean): void;
  expandFolders(ids: readonly string[]): void;
  /** Expands a row's ancestors and focuses it in the tree. */
  reveal(item: LibraryItemRef): void;
  startRename(item: LibraryItemRef): void;
  stopRename(): void;
  openMoveTo(items: readonly LibraryItemRef[]): void;
  openQuickOpen(): void;
  openMenu(item: LibraryItemRef, anchor: MenuAnchor, pinned?: boolean): void;
}

export interface LibraryContextValue {
  index: LibraryIndex;
  snapshot: LibraryIndexSnapshot;
  activeDocumentId: string | null;
  expanded: ReadonlySet<string>;
  /** The item key being renamed in the tree. */
  renaming: string | null;
  focusRequest: FocusRequest | null;
  recentDestinations: readonly (string | null)[];
  actions: LibraryActions;
}

const LibraryContext = createContext<LibraryContextValue | null>(null);

export function useLibrary(): LibraryContextValue {
  const value = useContext(LibraryContext);
  if (!value) throw new Error("useLibrary needs a <LibraryProvider>");
  return value;
}

function quote(text: string): string {
  return `“${text}”`;
}

function documents(count: number): string {
  return `${count} ${count === 1 ? "document" : "documents"}`;
}

/** The name a new folder gets: "New Folder", "New Folder 2"… */
function unusedFolderName(
  snapshot: LibraryIndexSnapshot,
  parentId: string | null,
): string {
  const taken = new Set(
    snapshot.folders
      .filter((folder) => folder.parentId === parentId)
      .map((folder) => folder.name),
  );
  if (!taken.has(NEW_FOLDER)) return NEW_FOLDER;
  for (let n = 2; ; n++) {
    if (!taken.has(`${NEW_FOLDER} ${n}`)) return `${NEW_FOLDER} ${n}`;
  }
}

function focusSoon(element: HTMLElement | null): void {
  if (!element) return;
  requestAnimationFrame(() => {
    if (element.isConnected) element.focus();
  });
}

export function LibraryProvider({
  index,
  onOpenDocument,
  onOpenPlace,
  activeDocumentId = null,
  children,
}: LibraryHostProps) {
  const subscribe = useCallback(
    (onChange: () => void) => index.subscribe(onChange),
    [index],
  );
  const read = useCallback(() => index.snapshot(), [index]);
  const snapshot = useSyncExternalStore(subscribe, read, read);

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [renaming, setRenaming] = useState<string | null>(null);
  const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
  const [recentDestinations, setRecentDestinations] = useState<
    (string | null)[]
  >([]);
  const [moveTo, setMoveTo] = useState<{
    items: LibraryItemRef[];
    returnFocus: HTMLElement | null;
  } | null>(null);
  const [quickOpen, setQuickOpen] = useState<{
    returnFocus: HTMLElement | null;
  } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [undoStack] = useState(createFileUndoStack);

  // Actions read the host's latest callbacks through a ref, so the actions
  // object is stable and rows never re-render because of it.
  const latest = useRef({ onOpenDocument, onOpenPlace });
  latest.current = { onOpenDocument, onOpenPlace };
  const serial = useRef(0);
  const menuSerial = useRef(0);

  const actions = useMemo<LibraryActions>(() => {
    // The index, not the last render: an action right after a write (reveal
    // after a move) must see that write.
    const now = () => index.snapshot();
    const labelOf = (item: LibraryItemRef) => {
      const snap = now();
      if (item.kind === "folder") {
        return snap.folders.find((folder) => folder.id === item.id)?.name ?? "";
      }
      const doc = snap.items.find((entry) => entry.id === item.id);
      return doc ? entryTitle(doc) : "";
    };
    const folderName = (id: string | null) =>
      id === null
        ? "Library"
        : (now().folders.find((folder) => folder.id === id)?.name ?? "Library");
    const requestFocus = (key: string) => {
      serial.current += 1;
      setFocusRequest({ key, serial: serial.current });
    };
    const expandAncestors = (folderId: string | null) => {
      const path = folderPath(indexFolders(now().folders), folderId);
      if (path.length === 0) return;
      setExpanded((current) => {
        if (path.every((folder) => current.has(folder.id))) return current;
        const next = new Set(current);
        for (const folder of path) next.add(folder.id);
        return next;
      });
    };
    const parentOf = (item: LibraryItemRef): string | null => {
      const snap = now();
      return item.kind === "doc"
        ? (snap.items.find((entry) => entry.id === item.id)?.folderId ?? null)
        : (snap.folders.find((folder) => folder.id === item.id)?.parentId ??
            null);
    };

    const self: LibraryActions = {
      open(id, target = "current") {
        index.markOpened(id);
        latest.current.onOpenDocument(id, target);
      },
      openPlace(place, target = "current") {
        latest.current.onOpenPlace?.(place, target);
      },
      createDocument(folderId) {
        const entry = index.create({ title: "", folderId });
        if (!entry) {
          announce("Couldn't create a document. Try again in a moment.");
          return;
        }
        // Focus goes to the new document's title (UX §8.2), not the row.
        expandAncestors(folderId);
        self.open(entry.id);
      },
      createFolder(parentId) {
        const snap = now();
        if (!canCreateFolderIn(indexFolders(snap.folders), parentId)) {
          announce(`Folders can be nested ${MAX_FOLDER_DEPTH} levels deep.`);
          return;
        }
        const folder = index.createFolder({
          name: unusedFolderName(snap, parentId),
          parentId,
        });
        if (!folder) {
          announce("Couldn't create a folder. Try again in a moment.");
          return;
        }
        expandAncestors(parentId);
        setRenaming(itemKey({ kind: "folder", id: folder.id }));
      },
      rename(item, name) {
        const clean = name.trim();
        const snap = now();
        const before =
          item.kind === "folder"
            ? (snap.folders.find((folder) => folder.id === item.id)?.name ?? "")
            : (snap.items.find((entry) => entry.id === item.id)?.title ?? "");
        if (clean === before.trim() || (item.kind === "folder" && !clean)) {
          return;
        }
        if (item.kind === "folder") index.renameFolder(item.id, clean);
        else index.rename(item.id, clean);
        undoStack.push({
          label: "Rename",
          undo: () => {
            if (item.kind === "folder") index.renameFolder(item.id, before);
            else index.rename(item.id, before);
            requestFocus(itemKey(item));
          },
        });
      },
      trash(items, focusAfter) {
        const docs = items.filter((item) => item.kind === "doc");
        const folders = items.filter((item) => item.kind === "folder");
        const firstLabel = items.length === 1 ? labelOf(items[0]) : "";
        void (async () => {
          const docResult =
            docs.length > 0
              ? await index.trash(docs.map((doc) => doc.id))
              : { trashed: [], failed: [] };
          const trashedFolders = (
            await Promise.all(folders.map((f) => index.trashFolder(f.id)))
          ).filter((folder) => folder !== null);
          const count = docResult.trashed.length + trashedFolders.length;
          if (count === 0) {
            announce("Couldn't move that to Trash.");
            return;
          }
          if (focusAfter) requestFocus(focusAfter);
          const inside = trashedFolders.reduce((n, f) => n + f.docCount, 0);
          let message: string;
          if (trashedFolders.length === 1 && docResult.trashed.length === 0) {
            message =
              inside > 0
                ? `Moved ${quote(trashedFolders[0].name)} and ${documents(inside)} to Trash.`
                : `Moved ${quote(trashedFolders[0].name)} to Trash.`;
          } else if (count === 1) {
            message = `Moved ${quote(firstLabel || docResult.trashed[0].title)} to Trash.`;
          } else if (trashedFolders.length === 0) {
            message = `Moved ${documents(count)} to Trash.`;
          } else {
            message = `Moved ${count} items to Trash.`;
          }
          const entry = undoStack.push({
            label: "Move to Trash",
            undo: async () => {
              for (const folder of trashedFolders) {
                await index.restoreFolder(folder.id);
              }
              if (docResult.trashed.length > 0) {
                await index.restore(docResult.trashed);
              }
              const first = docResult.trashed[0]
                ? { kind: "doc" as const, id: docResult.trashed[0].id }
                : { kind: "folder" as const, id: trashedFolders[0].id };
              self.reveal(first);
            },
          });
          announce(message, {
            action: { label: "Undo", run: () => void undoStack.run(entry) },
          });
        })();
      },
      move(items, folderId) {
        const firstLabel = items.length === 1 ? labelOf(items[0]) : "";
        const result = index.moveItems(items, folderId);
        if (!result.ok) {
          announce(moveRefusalMessage(result.reason));
          return false;
        }
        setRecentDestinations((current) =>
          [folderId, ...current.filter((id) => id !== folderId)].slice(
            0,
            RECENT_DESTINATIONS,
          ),
        );
        const moved = Object.entries(result.from).filter(
          ([, from]) => from !== folderId,
        );
        if (moved.length === 0) return true;
        const where = folderName(folderId);
        const entry = undoStack.push({
          label: "Move",
          undo: () => {
            const byParent = new Map<string | null, LibraryItemRef[]>();
            for (const [key, from] of moved) {
              const ref = parseItemKey(key);
              if (!ref) continue;
              const list = byParent.get(from) ?? [];
              list.push(ref);
              byParent.set(from, list);
            }
            for (const [from, refs] of byParent) index.moveItems(refs, from);
            self.reveal(items[0]);
          },
        });
        announce(
          items.length === 1
            ? `Moved ${quote(firstLabel)} to ${where}.`
            : `Moved ${items.length} items to ${where}.`,
          { action: { label: "Undo", run: () => void undoStack.run(entry) } },
        );
        return true;
      },
      pin(id) {
        index.pin(id);
        undoStack.push({ label: "Pin", undo: () => index.unpin(id) });
      },
      unpin(id) {
        index.unpin(id);
        undoStack.push({ label: "Unpin", undo: () => index.pin(id) });
      },
      movePin(id, to) {
        const pinned = pinnedEntries(now());
        const at = pinned.findIndex((item) => item.id === id);
        if (at < 0 || to < 0 || to >= pinned.length || to === at) return;
        index.movePin(id, to);
        undoStack.push({ label: "Move", undo: () => index.movePin(id, at) });
      },
      undo() {
        void undoStack.undo().then((done) => {
          if (!done) announce("Nothing to undo.");
        });
      },
      toggleFolder(id, open) {
        setExpanded((current) => {
          const want = open ?? !current.has(id);
          if (want === current.has(id)) return current;
          const next = new Set(current);
          if (want) next.add(id);
          else next.delete(id);
          return next;
        });
      },
      expandFolders(ids) {
        setExpanded((current) => {
          if (ids.every((id) => current.has(id))) return current;
          return new Set([...current, ...ids]);
        });
      },
      reveal(item) {
        expandAncestors(parentOf(item));
        requestFocus(itemKey(item));
      },
      startRename(item) {
        // The field takes focus itself; focusing the row would blur it.
        expandAncestors(parentOf(item));
        setRenaming(itemKey(item));
      },
      stopRename() {
        setRenaming(null);
      },
      openMoveTo(items) {
        if (items.length === 0) return;
        setMenu(null);
        setMoveTo({
          items: [...items],
          returnFocus: document.activeElement as HTMLElement | null,
        });
      },
      openQuickOpen() {
        setQuickOpen(
          (current) =>
            current ?? {
              returnFocus: document.activeElement as HTMLElement | null,
            },
        );
      },
      openMenu(item, anchor, pinned = false) {
        // Shift+F10 can also raise the browser's own `contextmenu` event:
        // one menu at a time, the first one wins.
        const returnFocus = document.activeElement as HTMLElement | null;
        menuSerial.current += 1;
        const serial = menuSerial.current;
        setMenu(
          (current) => current ?? { item, anchor, pinned, returnFocus, serial },
        );
      },
    };
    return self;
  }, [index, undoStack]);

  const value = useMemo<LibraryContextValue>(
    () => ({
      index,
      snapshot,
      activeDocumentId,
      expanded,
      renaming,
      focusRequest,
      recentDestinations,
      actions,
    }),
    [
      index,
      snapshot,
      activeDocumentId,
      expanded,
      renaming,
      focusRequest,
      recentDestinations,
      actions,
    ],
  );

  return (
    <LibraryContext.Provider value={value}>
      <LibraryDnd>{children}</LibraryDnd>
      {moveTo && (
        <MoveToDialog
          items={moveTo.items}
          onClose={(moved) => {
            const { returnFocus, items } = moveTo;
            setMoveTo(null);
            if (moved && items[0]) actions.reveal(items[0]);
            else focusSoon(returnFocus);
          }}
        />
      )}
      {quickOpen && (
        <QuickOpen
          onClose={(opened) => {
            const { returnFocus } = quickOpen;
            setQuickOpen(null);
            if (!opened) focusSoon(returnFocus);
          }}
        />
      )}
      {menu && (
        <ItemMenu
          key={menu.serial}
          item={menu.item}
          anchor={menu.anchor}
          pinned={menu.pinned}
          onClose={(keepFocus) => {
            const { returnFocus } = menu;
            setMenu(null);
            if (!keepFocus) focusSoon(returnFocus);
          }}
        />
      )}
    </LibraryContext.Provider>
  );
}
