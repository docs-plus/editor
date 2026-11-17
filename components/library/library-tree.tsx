"use client";

/**
 * The Library tree (WAI-ARIA APG Tree View, UX §4.6 and §8.1): flat rows
 * with `aria-level`, `aria-setsize` and `aria-posinset`, one roving tab
 * stop, multi-select (Shift+↑↓, ⌘A), type-ahead, F2 rename, Move to Trash,
 * file-operation undo (⌘Z), Shift+F10 menus and pointer drag and drop.
 * Rows never contain buttons: the chevron is a plain, hidden-from-AT span
 * (→ / ← and clicks on the row do the same).
 */
import {
  type KeyboardEvent,
  type MouseEvent,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";

import {
  ChevronRightIcon,
  FileTextIcon,
  FolderIcon,
  FolderOpenIcon,
} from "@/lib/icons";
import {
  horizontalIntent,
  isContextMenuKey,
  isNewFolderKey,
  isTrashKey,
  isUndoKey,
  openTarget,
} from "@/lib/library/library-keys";
import {
  buildTreeRows,
  itemKey,
  parseItemKey,
  type TreeRow,
} from "@/lib/library/tree-rows";
import type { LibraryItemRef } from "@/lib/platform/document-index";
import { normalizeSearchText } from "@/lib/search/normalize";
import { isMac } from "@/lib/shortcuts";

import { useLibrary } from "./library-context";
import {
  type DragPayload,
  useDropHighlight,
  useLibraryRowDnd,
} from "./library-dnd";
import { type RenameExit, RenameField } from "./rename-field";

const TYPEAHEAD_MS = 600;

function refOf(row: TreeRow): LibraryItemRef {
  return row.kind === "folder"
    ? { kind: "folder", id: row.id }
    : { kind: "doc", id: row.id };
}

function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every((key) => b.has(key));
}

interface RowProps {
  row: TreeRow;
  tabbable: boolean;
  selected: boolean;
  current: boolean;
  renaming: boolean;
  payload: DragPayload;
  register: (key: string, element: HTMLElement | null) => void;
  onRowClick: (row: TreeRow, event: MouseEvent) => void;
  onRowAuxClick: (row: TreeRow, event: MouseEvent) => void;
  onRowContextMenu: (row: TreeRow, event: MouseEvent) => void;
  onRenameDone: (row: TreeRow, next: RenameExit) => void;
}

const LibraryTreeRow = memo(function LibraryTreeRow({
  row,
  tabbable,
  selected,
  current,
  renaming,
  payload,
  register,
  onRowClick,
  onRowAuxClick,
  onRowContextMenu,
  onRenameDone,
}: RowProps) {
  const folder = row.kind === "folder";
  const target = useMemo(
    () => (folder ? { kind: "folder" as const, id: row.id } : undefined),
    [folder, row.id],
  );
  const dnd = useLibraryRowDnd({
    dragId: `tree:${row.key}`,
    payload,
    target,
    disabled: renaming,
  });
  const highlight = useDropHighlight(target);
  const { ref: dndRef } = dnd;
  const ref = useCallback(
    (element: HTMLDivElement | null) => {
      dndRef(element);
      register(row.key, element);
    },
    [dndRef, register, row.key],
  );
  const Icon = folder
    ? row.expanded
      ? FolderOpenIcon
      : FolderIcon
    : FileTextIcon;
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the tree's roving onKeyDown handles keys
    <div
      ref={ref}
      role="treeitem"
      aria-level={row.level}
      aria-setsize={row.setSize}
      aria-posinset={row.posInSet}
      aria-expanded={folder ? row.expanded : undefined}
      aria-selected={selected}
      aria-current={current ? "page" : undefined}
      tabIndex={tabbable ? 0 : -1}
      data-key={row.key}
      data-region-entry={tabbable ? "" : undefined}
      data-drop={highlight ?? undefined}
      data-dragging={dnd.isDragging ? "" : undefined}
      className="lib-treeitem"
      style={{ "--lib-level": row.level } as React.CSSProperties}
      onClick={(event) => onRowClick(row, event)}
      onAuxClick={(event) => onRowAuxClick(row, event)}
      onContextMenu={(event) => onRowContextMenu(row, event)}
      {...dnd.listeners}
    >
      <span className="lib-row">
        <span className="lib-chevron" data-chevron="" aria-hidden="true">
          {folder && !row.empty ? <ChevronRightIcon /> : null}
        </span>
        <Icon className="lib-row-icon" aria-hidden="true" />
        {renaming ? (
          <RenameField
            item={refOf(row)}
            onDone={(next) => onRenameDone(row, next)}
          />
        ) : (
          <span className="lib-label" title={row.label}>
            <bdi dir="auto">{row.label}</bdi>
          </span>
        )}
      </span>
    </div>
  );
});

export function LibraryTree() {
  const {
    snapshot,
    expanded,
    renaming,
    focusRequest,
    activeDocumentId,
    actions,
  } = useLibrary();
  const rows = useMemo(
    () => buildTreeRows(snapshot, expanded),
    [snapshot, expanded],
  );
  const rowIndex = useMemo(
    () => new Map(rows.map((row, at) => [row.key, at])),
    [rows],
  );
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [selection, setSelection] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const anchor = useRef<string | null>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  const handledRequest = useRef(0);
  const typeahead = useRef({
    buffer: "",
    timer: undefined as ReturnType<typeof setTimeout> | undefined,
  });
  const treeRef = useRef<HTMLDivElement>(null);

  const activeKey = activeDocumentId
    ? itemKey({ kind: "doc", id: activeDocumentId })
    : null;
  const tabKey =
    (focusKey && rowIndex.has(focusKey) ? focusKey : null) ??
    (activeKey && rowIndex.has(activeKey) ? activeKey : null) ??
    rows[0]?.key ??
    null;

  const register = useCallback((key: string, element: HTMLElement | null) => {
    if (element) elements.current.set(key, element);
    else elements.current.delete(key);
  }, []);

  // Bumped on every focus request, so the layout effect below always runs,
  // even when the focused key and selection don't change.
  const [focusSerial, bumpFocusSerial] = useReducer((n: number) => n + 1, 0);

  const focusRow = useCallback(
    (key: string, mode: "select" | "extend" | "keep" = "select") => {
      setFocusKey(key);
      pendingFocus.current = key;
      bumpFocusSerial();
      if (mode === "select") {
        anchor.current = key;
        setSelection((current) =>
          current.size === 1 && current.has(key) ? current : new Set([key]),
        );
      } else if (mode === "extend") {
        const from = rowIndex.get(anchor.current ?? key) ?? 0;
        const to = rowIndex.get(key) ?? 0;
        const [lo, hi] = from < to ? [from, to] : [to, from];
        const next = new Set(rows.slice(lo, hi + 1).map((row) => row.key));
        setSelection((current) => (sameSet(current, next) ? current : next));
      }
    },
    [rowIndex, rows],
  );

  // Focus lands after the render that made the row tabbable. A row that
  // isn't rendered yet (a folder still expanding) keeps the request.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs per request and per row change
  useLayoutEffect(() => {
    const key = pendingFocus.current;
    if (!key) return;
    const element = elements.current.get(key);
    if (!element) return;
    pendingFocus.current = null;
    element.focus();
    element.scrollIntoView?.({ block: "nearest" });
  }, [focusSerial, rows]);

  // The row being renamed becomes the tab stop; its field has focus, so
  // no row focus may be pending.
  useEffect(() => {
    if (!renaming) return;
    pendingFocus.current = null;
    setFocusKey(renaming);
  }, [renaming]);

  // Requests from actions (reveal, undo): wait for the row.
  useEffect(() => {
    if (!focusRequest || focusRequest.serial === handledRequest.current) return;
    if (!rowIndex.has(focusRequest.key)) return;
    handledRequest.current = focusRequest.serial;
    focusRow(focusRequest.key);
  }, [focusRequest, rowIndex, focusRow]);

  // Where the focused row was, for when it disappears (trash, a move).
  const lastIndex = useRef(0);
  if (focusKey && rowIndex.has(focusKey)) {
    lastIndex.current = rowIndex.get(focusKey) ?? 0;
  }

  // A row hidden by a collapse hands focus to its nearest visible folder
  // (UX §8.1); a removed row to the row now in its place, or the last one.
  useLayoutEffect(() => {
    if (!focusKey || rowIndex.has(focusKey) || rows.length === 0) return;
    const ref = parseItemKey(focusKey);
    let parent: string | null = null;
    if (ref?.kind === "doc") {
      parent =
        snapshot.items.find((doc) => doc.id === ref.id)?.folderId ?? null;
    } else if (ref?.kind === "folder") {
      parent =
        snapshot.folders.find((folder) => folder.id === ref.id)?.parentId ??
        null;
    }
    while (parent && !rowIndex.has(itemKey({ kind: "folder", id: parent }))) {
      const id: string = parent;
      parent =
        snapshot.folders.find((folder) => folder.id === id)?.parentId ?? null;
    }
    const key = parent
      ? itemKey({ kind: "folder", id: parent })
      : rows[Math.min(lastIndex.current, rows.length - 1)].key;
    const hadFocus =
      treeRef.current?.contains(document.activeElement) ||
      document.activeElement === document.body;
    setFocusKey(key);
    if (hadFocus) {
      pendingFocus.current = key;
      bumpFocusSerial();
    }
  }, [focusKey, rowIndex, rows, snapshot]);

  const selectedRefs = useCallback(
    (row: TreeRow): LibraryItemRef[] => {
      if (selection.has(row.key) && selection.size > 1) {
        return rows.filter((r) => selection.has(r.key)).map(refOf);
      }
      return [refOf(row)];
    },
    [rows, selection],
  );

  const openRow = useCallback(
    (row: TreeRow, target: ReturnType<typeof openTarget>) => {
      if (row.kind === "doc") {
        actions.open(row.id, target);
      } else {
        actions.toggleFolder(row.id, true);
        actions.openPlace({ kind: "folder", id: row.id }, target);
      }
    },
    [actions],
  );

  const onRowClick = useCallback(
    (row: TreeRow, event: MouseEvent) => {
      if ((event.target as HTMLElement).closest("input")) return;
      if ((event.target as HTMLElement).closest("[data-chevron]")) {
        focusRow(row.key);
        if (row.kind === "folder") actions.toggleFolder(row.id);
        return;
      }
      focusRow(row.key);
      openRow(row, openTarget(event, isMac()));
    },
    [actions, focusRow, openRow],
  );

  const onRowAuxClick = useCallback(
    (row: TreeRow, event: MouseEvent) => {
      if (event.button !== 1 || row.kind !== "doc") return;
      event.preventDefault();
      actions.open(row.id, "tab");
    },
    [actions],
  );

  const onRowContextMenu = useCallback(
    (row: TreeRow, event: MouseEvent) => {
      event.preventDefault();
      focusRow(row.key);
      actions.openMenu(refOf(row), { x: event.clientX, y: event.clientY });
    },
    [actions, focusRow],
  );

  const onRenameDone = useCallback(
    (row: TreeRow, next: RenameExit) => {
      actions.stopRename();
      if (next === "none") return;
      const at = rowIndex.get(row.key) ?? 0;
      const target = next === "next" ? (rows[at + 1] ?? row) : row;
      focusRow(target.key);
    },
    [actions, focusRow, rowIndex, rows],
  );

  /** The row after the removed ones, or the one before (UX §8.2). */
  const focusAfterRemoving = (keys: ReadonlySet<string>, row: TreeRow) => {
    // Rows are in tree order, so a folder's descendants follow it with a
    // deeper level.
    const gone = new Set<number>();
    rows.forEach((r, start) => {
      if (!keys.has(r.key)) return;
      gone.add(start);
      for (let i = start + 1; i < rows.length && rows[i].level > r.level; i++) {
        gone.add(i);
      }
    });
    const at = rowIndex.get(row.key) ?? 0;
    for (let i = at + 1; i < rows.length; i++) {
      if (!gone.has(i)) return rows[i].key;
    }
    for (let i = at - 1; i >= 0; i--) {
      if (!gone.has(i)) return rows[i].key;
    }
    return null;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("input")) return;
    const key = tabKey;
    const row = key ? rows[rowIndex.get(key) ?? -1] : undefined;
    if (!row) return;
    const at = rowIndex.get(row.key) ?? 0;
    const mac = isMac();
    const mode = event.shiftKey ? "extend" : "select";
    const go = (to: number) => {
      const target = rows[Math.min(Math.max(to, 0), rows.length - 1)];
      if (target) focusRow(target.key, mode);
    };
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };

    if (isContextMenuKey(event)) {
      handled();
      const element = elements.current.get(row.key);
      if (element) actions.openMenu(refOf(row), element);
      return;
    }
    if (isUndoKey(event, mac)) {
      handled();
      actions.undo();
      return;
    }
    if (isTrashKey(event, mac)) {
      handled();
      const items = selectedRefs(row);
      const keys = new Set(items.map(itemKey));
      actions.trash(items, focusAfterRemoving(keys, row));
      return;
    }
    if (isNewFolderKey(event, mac)) {
      handled();
      actions.createFolder(row.kind === "folder" ? row.id : row.parentId);
      return;
    }
    const intent = horizontalIntent(
      event.key,
      treeRef.current && getComputedStyle(treeRef.current).direction === "rtl"
        ? "rtl"
        : "ltr",
    );
    if (intent && !event.altKey && !event.metaKey && !event.ctrlKey) {
      handled();
      if (intent === "in" && row.kind === "folder") {
        if (!row.expanded) actions.toggleFolder(row.id, true);
        else if (rows[at + 1]?.level === row.level + 1) go(at + 1);
      } else if (intent === "out") {
        if (row.kind === "folder" && row.expanded) {
          actions.toggleFolder(row.id, false);
        } else if (row.parentId) {
          focusRow(itemKey({ kind: "folder", id: row.parentId }));
        }
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        handled();
        go(at + 1);
        return;
      case "ArrowUp":
        handled();
        go(at - 1);
        return;
      case "Home":
        handled();
        go(0);
        return;
      case "End":
        handled();
        go(rows.length - 1);
        return;
      case "Enter":
        handled();
        openRow(row, openTarget(event, mac));
        return;
      case "F2":
        handled();
        actions.startRename(refOf(row));
        return;
      case "Escape":
        if (selection.size === 0) return;
        handled();
        setSelection(new Set());
        return;
      case "*": {
        handled();
        actions.expandFolders(
          rows
            .filter(
              (r) =>
                r.kind === "folder" &&
                r.parentId === row.parentId &&
                r.level === row.level,
            )
            .map((r) => r.id),
        );
        return;
      }
    }
    if (
      (mac ? event.metaKey : event.ctrlKey) &&
      !event.shiftKey &&
      !event.altKey &&
      (event.key.toLowerCase() === "a" || event.code === "KeyA")
    ) {
      handled();
      setSelection(
        new Set(
          rows
            .filter((r) => r.parentId === row.parentId && r.level === row.level)
            .map((r) => r.key),
        ),
      );
      return;
    }
    const state = typeahead.current;
    if (
      event.key.length === 1 &&
      // Space continues a type-ahead ("Q4 plan") but never starts one.
      (event.key !== " " || state.buffer !== "") &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      handled();
      clearTimeout(state.timer);
      state.buffer += normalizeSearchText(event.key);
      state.timer = setTimeout(() => {
        state.buffer = "";
      }, TYPEAHEAD_MS);
      const order = [...rows.slice(at + 1), ...rows.slice(0, at + 1)];
      const single = state.buffer.length === 1;
      const hit = (single ? order : [row, ...order]).find((r) =>
        normalizeSearchText(r.label).startsWith(state.buffer),
      );
      if (hit) focusRow(hit.key);
    }
  };

  // One payload per row, rebuilt only when rows or the selection change.
  const payloads = useMemo(
    () =>
      new Map(
        rows.map((row) => [
          row.key,
          { items: selectedRefs(row), label: row.label } satisfies DragPayload,
        ]),
      ),
    [rows, selectedRefs],
  );

  if (rows.length === 0) {
    return <p className="lib-empty-row">No documents</p>;
  }

  return (
    <div
      ref={treeRef}
      role="tree"
      aria-label="Library"
      aria-multiselectable="true"
      className="lib-tree"
      onKeyDown={onKeyDown}
      onFocus={(event) => {
        const key = (event.target as HTMLElement).dataset.key;
        if (key && key !== focusKey) setFocusKey(key);
      }}
    >
      {rows.map((row) => (
        <LibraryTreeRow
          key={row.key}
          row={row}
          tabbable={row.key === tabKey}
          selected={selection.has(row.key)}
          current={row.key === activeKey}
          renaming={renaming === row.key}
          payload={
            payloads.get(row.key) ?? { items: [refOf(row)], label: row.label }
          }
          register={register}
          onRowClick={onRowClick}
          onRowAuxClick={onRowAuxClick}
          onRowContextMenu={onRowContextMenu}
          onRenameDone={onRenameDone}
        />
      ))}
    </div>
  );
}
