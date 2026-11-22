"use client";

/**
 * A list view in the main area (UX §4.1, §4.6 "List view", §8.1; details
 * spec §6.3): Recent, Pinned, the Library root, a folder, a tag or Trash.
 * Sort, view and group are kept per place in the index; the filter bar
 * (⌘F while the list has focus; titles, tags and folder names, D24) is per
 * window and not saved. Rows are windowed (`lib/library/list-window.ts`),
 * the focused row always stays mounted, and rows inserted above the
 * viewport keep the visible ones still.
 */
import "./library.css";

import {
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArchiveRestoreIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  ClockIcon,
  CloseIcon,
  FilePlusIcon,
  FolderIcon,
  LibraryIcon,
  PinIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  TagIcon,
  TrashIcon,
} from "@/lib/icons";
import {
  isContextMenuKey,
  isFilterKey,
  isSelectAllKey,
  isTrashKey,
  isUndoKey,
  manualMoveKey,
  openTarget,
} from "@/lib/library/library-keys";
import {
  buildListRows,
  compareManual,
  type ListRow,
} from "@/lib/library/list-rows";
import {
  defaultDescending,
  groupOptions,
  listPlaceKey,
  resolveListView,
  sortOptions,
} from "@/lib/library/list-view";
import {
  anchoredScrollTop,
  rowOffsets,
  type ScrollAnchor,
  scrollToShow,
  visibleRange,
} from "@/lib/library/list-window";
import { nameCollator, pinnedEntries } from "@/lib/library/tree-rows";
import type {
  LibraryItemRef,
  ListSortField,
  ListViewPrefs,
  TrashedItem,
} from "@/lib/platform/document-index";
import { normalizeSearchText } from "@/lib/search/normalize";
import { isMac } from "@/lib/shortcuts";

import { EntryMenu, type ItemMenuEntry, type MenuAnchor } from "./item-menu";
import { type LibraryPlace, useLibrary } from "./library-context";
import { ListRowView } from "./list-row";
import type { RenameExit } from "./rename-field";

export const ROW_HEIGHT = 32;
export const PREVIEW_ROW_HEIGHT = 72;
export const GROUP_ROW_HEIGHT = 28;
const OVERSCAN = 8;
const TYPE_AHEAD_MS = 700;
const DAY = 86_400_000;

const SORT_LABELS: Record<ListSortField, string> = {
  title: "Title",
  modified: "Modified",
  created: "Created",
  opened: "Opened",
  manual: "Manual",
};
const GROUP_LABELS: Record<ListViewPrefs["group"], string> = {
  none: "None",
  date: "By date",
  folder: "By folder",
};

type Since = "any" | "day" | "week" | "month" | "year";
const SINCE: Record<Since, { label: string; days: number | null }> = {
  any: { label: "Any time", days: null },
  day: { label: "Today", days: 0 },
  week: { label: "Past 7 days", days: 7 },
  month: { label: "Past 30 days", days: 30 },
  year: { label: "Past year", days: 365 },
};

function sinceTime(since: Since, now: number): number | null {
  const { days } = SINCE[since];
  if (days === null) return null;
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return start.getTime() - days * DAY;
}

/** Set before opening a folder from a list, so its list takes focus. */
let focusNextList = false;

function requestListFocus(): void {
  focusNextList = true;
}

function takeListFocus(): boolean {
  const wanted = focusNextList;
  focusNextList = false;
  return wanted;
}

/** Milliseconds until the next local midnight. */
function untilMidnight(now: number): number {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return next.getTime() - now;
}

function isRowKind(row: ListRow): boolean {
  return row.kind !== "group";
}

function refOf(row: ListRow): LibraryItemRef | null {
  if (row.kind === "doc") return { kind: "doc", id: row.id };
  if (row.kind === "folder") return { kind: "folder", id: row.id };
  return null;
}

function rowLabel(row: ListRow): string {
  switch (row.kind) {
    case "doc":
      return row.title;
    case "folder":
      return row.name;
    case "trash":
      return row.label;
    default:
      return "";
  }
}

function directionLabels(sort: ListSortField): [string, string] {
  if (sort === "title") return ["A to Z", "Z to A"];
  return ["Oldest first", "Newest first"];
}

export interface LibraryListProps {
  place: LibraryPlace;
  /** Focus the first row on mount (the host opened the list by keyboard). */
  autoFocus?: boolean;
  /** The locale's first day of the week for By date; default Monday. */
  weekStart?: number;
}

/** The list for `place`; its filter and selection reset with the place. */
export function LibraryList(props: LibraryListProps) {
  return <PlaceList key={listPlaceKey(props.place)} {...props} />;
}

function PlaceList(props: LibraryListProps) {
  const { autoFocus = false, weekStart } = props;
  // Keyed by place: the place never changes while this list lives.
  const [place] = useState(props.place);
  const { index, snapshot, actions } = useLibrary();
  const placeKey = listPlaceKey(place);
  const prefs = useMemo(
    () => resolveListView(place, snapshot.listViews),
    [place, snapshot.listViews],
  );
  const mac = isMac();

  const [filterText, setFilterText] = useState("");
  const [filterTags, setFilterTags] = useState<readonly string[]>([]);
  const [since, setSince] = useState<Since>("any");
  const deferredText = useDeferredValue(filterText);
  const filterRef = useRef<HTMLInputElement>(null);

  // "Today" and "Yesterday" move at midnight.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), untilMidnight(now) + 1);
    return () => clearTimeout(timer);
  }, [now]);
  const result = useMemo(
    () =>
      buildListRows({
        snapshot,
        place,
        prefs,
        filter: {
          text: deferredText,
          tagIds: filterTags,
          since: sinceTime(since, now),
        },
        now,
        weekStart,
      }),
    [snapshot, place, prefs, deferredText, filterTags, since, now, weekStart],
  );
  const rows = result.rows;
  const preview = prefs.view === "preview";
  const folderColumn =
    place.kind === "recent" ||
    place.kind === "pinned" ||
    place.kind === "tag" ||
    place.kind === "trash";

  const heights = useMemo(
    () =>
      rows.map((row) =>
        row.kind === "group"
          ? GROUP_ROW_HEIGHT
          : preview && row.kind === "doc"
            ? PREVIEW_ROW_HEIGHT
            : ROW_HEIGHT,
      ),
    [rows, preview],
  );
  const offsets = useMemo(() => rowOffsets(heights), [heights]);
  const keys = useMemo(() => rows.map((row) => row.key), [rows]);
  const indexOf = useMemo(
    () => new Map(keys.map((key, at) => [key, at])),
    [keys],
  );

  // Selection and focus (UX §4.6 "List view").
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const anchorKey = useRef<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    anchor: MenuAnchor;
    items: TrashedItem[];
  } | null>(null);

  // Windowing.
  const body = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewport, setViewport] = useState(600);
  const anchor = useRef<ScrollAnchor | null>(null);
  const [focusOnMount] = useState(takeListFocus);
  const wantFocus = useRef(autoFocus || focusOnMount);

  useLayoutEffect(() => {
    const element = body.current;
    if (!element) return;
    setViewport(element.clientHeight);
    const observer = new ResizeObserver(() =>
      setViewport(element.clientHeight),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const remember = useCallback(
    (top: number) => {
      const range = visibleRange(offsets, top, 1, 0);
      const key = keys[range.start];
      anchor.current =
        key === undefined ? null : { key, delta: offsets[range.start] - top };
    },
    [offsets, keys],
  );

  // Rows changed (a live update): keep the anchored row where it was.
  useLayoutEffect(() => {
    const element = body.current;
    const held = anchor.current;
    if (!element || !held || element.scrollTop === 0) {
      if (element) remember(element.scrollTop);
      return;
    }
    const top = anchoredScrollTop(held, keys, offsets);
    if (top !== null && Math.abs(top - element.scrollTop) > 0.5) {
      element.scrollTop = top;
      setScrollTop(top);
    }
    remember(element.scrollTop);
  }, [keys, offsets, remember]);

  // The focused row, or the first row, is the list's one tab stop.
  const focusable = useMemo(
    () => rows.filter(isRowKind).map((row) => row.key),
    [rows],
  );
  const activeKey =
    focusKey !== null && indexOf.has(focusKey) ? focusKey : focusable[0];

  const focusRow = useCallback(
    (key: string | undefined, scroll = true) => {
      if (key === undefined) return;
      const element = body.current;
      const at = indexOf.get(key);
      if (element && at !== undefined && scroll) {
        const top = scrollToShow(
          offsets,
          at,
          element.scrollTop,
          element.clientHeight,
        );
        if (top !== element.scrollTop) {
          element.scrollTop = top;
          setScrollTop(top);
        }
      }
      setFocusKey(key);
      // Focus at once when the row is mounted (the state may not change);
      // otherwise after the render that mounts it.
      const mountedRow = element?.querySelector<HTMLElement>(
        `[data-key="${CSS.escape(key)}"]`,
      );
      if (mountedRow) mountedRow.focus({ preventScroll: true });
      else wantFocus.current = true;
    },
    [indexOf, offsets],
  );

  // Move DOM focus once the focused row is rendered.
  useLayoutEffect(() => {
    if (!wantFocus.current || renaming) return;
    const key = activeKey;
    if (key === undefined) {
      wantFocus.current = false;
      return;
    }
    const element = body.current?.querySelector<HTMLElement>(
      `[data-key="${CSS.escape(key)}"]`,
    );
    if (element) {
      wantFocus.current = false;
      element.focus({ preventScroll: true });
    }
  });

  const range = visibleRange(offsets, scrollTop, viewport, OVERSCAN);
  const mounted: number[] = [];
  for (let at = range.start; at < range.end; at++) mounted.push(at);
  const activeAt =
    activeKey === undefined ? -1 : (indexOf.get(activeKey) ?? -1);
  if (activeAt >= 0 && (activeAt < range.start || activeAt >= range.end)) {
    mounted.push(activeAt);
  }

  const rowByKey = (key: string) => rows[indexOf.get(key) ?? -1];
  const targets = (): ListRow[] => {
    const chosen = [...selected]
      .map(rowByKey)
      .filter((row): row is ListRow => row !== undefined);
    if (chosen.length > 0) return chosen;
    const own = activeKey === undefined ? undefined : rowByKey(activeKey);
    return own ? [own] : [];
  };

  const setPrefs = (next: Partial<ListViewPrefs>) =>
    index.setListView(placeKey, next);

  const open = (row: ListRow, event?: KeyboardEvent | MouseEvent) => {
    const target = event ? openTarget(event, mac) : "current";
    if (row.kind === "doc") actions.open(row.id, target);
    else if (row.kind === "folder") {
      if (target === "current") requestListFocus();
      actions.openPlace({ kind: "folder", id: row.id }, target);
    } else if (row.kind === "trash" && row.item.kind === "doc") {
      actions.open(row.item.id, target);
    }
  };

  const restore = (items: readonly TrashedItem[]) => {
    if (items.length === 0) return;
    const after = nextKeyAfter(
      items.map((item) => `trash:${item.kind}:${item.id}`),
    );
    actions.restoreTrashed(items);
    setSelected(new Set());
    if (after) focusRow(after);
  };

  /** The row to focus once `gone` leave the list (UX §8.2). */
  const nextKeyAfter = (gone: readonly string[]): string | undefined => {
    const leaving = new Set(gone);
    const at = activeKey === undefined ? 0 : focusable.indexOf(activeKey);
    for (let n = at + 1; n < focusable.length; n++) {
      if (!leaving.has(focusable[n])) return focusable[n];
    }
    for (let n = at - 1; n >= 0; n--) {
      if (!leaving.has(focusable[n])) return focusable[n];
    }
    return undefined;
  };

  const manualMove = (row: ListRow, direction: "up" | "down") => {
    if (row.kind !== "doc" || prefs.sort !== "manual") return false;
    const step = (direction === "up" ? -1 : 1) * (prefs.descending ? -1 : 1);
    if (place.kind === "pinned") {
      const pinned = pinnedEntries(snapshot);
      const at = pinned.findIndex((entry) => entry.id === row.id);
      if (at >= 0) actions.movePin(row.id, at + step);
      return true;
    }
    if (place.kind !== "folder" && place.kind !== "library") return false;
    const folderId = row.entry.folderId ?? null;
    const order = snapshot.items
      .filter((entry) => (entry.folderId ?? null) === folderId)
      .sort(compareManual);
    const at = order.findIndex((entry) => entry.id === row.id);
    if (at >= 0) actions.moveInFolder(row.id, at + step);
    return true;
  };

  const menuFor = (row: ListRow, at: MenuAnchor) => {
    if (row.kind === "trash") {
      const items = targets()
        .filter((target) => target.kind === "trash")
        .map((target) => target.item);
      // Shift+F10 can also raise the browser's `contextmenu`: first wins.
      setMenu(
        (current) =>
          current ?? {
            anchor: at,
            items: items.length > 0 ? items : [row.item],
          },
      );
      return;
    }
    const ref = refOf(row);
    if (!ref) return;
    const extra: ItemMenuEntry[] = [];
    const manual =
      prefs.sort === "manual" &&
      row.kind === "doc" &&
      (place.kind === "folder" || place.kind === "library");
    if (manual) {
      extra.push(
        {
          id: "manual-up",
          label: "Move Up",
          shortcut: mac ? "⌥⌘↑" : "Ctrl+Alt+↑",
          run: () => manualMove(row, "up"),
        },
        {
          id: "manual-down",
          label: "Move Down",
          shortcut: mac ? "⌥⌘↓" : "Ctrl+Alt+↓",
          run: () => manualMove(row, "down"),
        },
      );
    }
    actions.openMenu(ref, at, place.kind === "pinned", extra);
  };

  // Type-to-select.
  const typed = useRef({ text: "", at: 0 });
  const typeAhead = (char: string) => {
    const now = performance.now();
    const buffer =
      now - typed.current.at < TYPE_AHEAD_MS ? typed.current.text + char : char;
    typed.current = { text: buffer, at: now };
    const wanted = normalizeSearchText(buffer);
    const start = activeKey === undefined ? 0 : focusable.indexOf(activeKey);
    const order = [
      ...focusable.slice(buffer.length === 1 ? start + 1 : start),
      ...focusable.slice(0, start),
    ];
    const hit = order.find((key) => {
      const row = rowByKey(key);
      return row && normalizeSearchText(rowLabel(row)).startsWith(wanted);
    });
    if (hit) {
      setSelected(new Set([hit]));
      anchorKey.current = hit;
      focusRow(hit);
    }
  };

  const moveFocus = (to: number, extend: boolean) => {
    const clamped = Math.max(0, Math.min(focusable.length - 1, to));
    const key = focusable[clamped];
    if (key === undefined) return;
    if (extend) {
      const from = anchorKey.current ?? activeKey ?? key;
      const a = focusable.indexOf(from);
      const [lo, hi] = a < clamped ? [a, clamped] : [clamped, a];
      setSelected(new Set(focusable.slice(lo, hi + 1)));
    } else {
      anchorKey.current = key;
      setSelected(new Set([key]));
    }
    focusRow(key);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (renaming) return;
    const row = activeKey === undefined ? undefined : rowByKey(activeKey);
    const at = activeKey === undefined ? -1 : focusable.indexOf(activeKey);
    const page = Math.max(1, Math.floor(viewport / ROW_HEIGHT) - 1);
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (isFilterKey(event, mac)) {
      handled();
      filterRef.current?.focus();
      filterRef.current?.select();
      return;
    }
    const manual = manualMoveKey(event, mac);
    if (manual && row) {
      if (manualMove(row, manual)) handled();
      return;
    }
    if (isContextMenuKey(event) && row) {
      handled();
      const element = body.current?.querySelector<HTMLElement>(
        `[data-key="${CSS.escape(row.key)}"]`,
      );
      menuFor(row, element ?? { x: 0, y: 0 });
      return;
    }
    if (isSelectAllKey(event, mac)) {
      handled();
      setSelected(new Set(focusable));
      return;
    }
    if (isUndoKey(event, mac)) {
      handled();
      actions.undo();
      return;
    }
    if (isTrashKey(event, mac)) {
      if (place.kind === "trash") return;
      const refs = targets()
        .map(refOf)
        .filter((ref): ref is LibraryItemRef => ref !== null);
      if (refs.length === 0) return;
      handled();
      const after = nextKeyAfter(refs.map((ref) => `${ref.kind}:${ref.id}`));
      actions.trash(refs, null, (first) => {
        const key = `${first.kind}:${first.id}`;
        setSelected(new Set([key]));
        focusRow(key);
      });
      setSelected(new Set());
      if (after) focusRow(after);
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        handled();
        moveFocus(at + 1, event.shiftKey);
        return;
      case "ArrowUp":
        handled();
        moveFocus(at - 1, event.shiftKey);
        return;
      case "Home":
        handled();
        moveFocus(0, event.shiftKey);
        return;
      case "End":
        handled();
        moveFocus(focusable.length - 1, event.shiftKey);
        return;
      case "PageDown":
        handled();
        moveFocus(at + page, event.shiftKey);
        return;
      case "PageUp":
        handled();
        moveFocus(at - page, event.shiftKey);
        return;
      case "Enter":
        if (row) {
          handled();
          open(row, event);
        }
        return;
      case "F2":
        if (row && (row.kind === "doc" || row.kind === "folder")) {
          handled();
          setRenaming(row.key);
        }
        return;
      case "Escape":
        if (selected.size > 0) {
          handled();
          setSelected(new Set());
        }
        return;
      case " ":
        if (row) {
          handled();
          setSelected((current) => {
            const next = new Set(current);
            if (next.has(row.key)) next.delete(row.key);
            else next.add(row.key);
            return next;
          });
          anchorKey.current = row.key;
        }
        return;
    }
    if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      handled();
      typeAhead(event.key);
    }
  };

  const onRenameDone = useCallback(
    (row: ListRow, next: RenameExit) => {
      setRenaming(null);
      if (next === "none") return;
      if (next === "next") {
        const at = focusable.indexOf(row.key);
        focusRow(focusable[at + 1] ?? row.key);
      } else {
        focusRow(row.key);
      }
    },
    [focusable, focusRow],
  );

  const keyOfEvent = (event: MouseEvent): string | null =>
    (event.target as HTMLElement)
      .closest<HTMLElement>("[data-key]")
      ?.getAttribute("data-key") ?? null;

  const title = placeTitle(place, snapshot);
  const sorts = sortOptions(place);
  const groups = groupOptions(place);
  const filtering =
    filterText.trim() !== "" || filterTags.length > 0 || since !== "any";
  const sortTags = [...snapshot.tags].sort((a, b) =>
    nameCollator.compare(a.name, b.name),
  );
  const chosenTags = filterTags
    .map((id) => snapshot.tags.find((tag) => tag.id === id))
    .filter((tag) => tag !== undefined);
  const restorable = targets().filter((row) => row.kind === "trash");
  const dateLabel =
    place.kind === "trash"
      ? "Deleted"
      : prefs.sort === "created" || prefs.sort === "opened"
        ? SORT_LABELS[prefs.sort]
        : "Modified";
  const ariaSort = (column: "title" | "date") => {
    const active =
      column === "title"
        ? prefs.sort === "title"
        : prefs.sort !== "title" && prefs.sort !== "manual";
    if (!active || place.kind === "trash") return undefined;
    return prefs.descending ? "descending" : "ascending";
  };
  const sortBy = (column: "title" | "date") => {
    if (place.kind === "trash") return;
    const field: ListSortField =
      column === "title"
        ? "title"
        : prefs.sort === "created" || prefs.sort === "opened"
          ? prefs.sort
          : "modified";
    setPrefs({
      sort: field,
      descending:
        prefs.sort === field ? !prefs.descending : defaultDescending(field),
    });
  };

  const total = offsets[offsets.length - 1];
  const empty = rows.length === 0;

  return (
    <section
      className="lib-list"
      aria-labelledby={`lib-list-title-${placeKey}`}
      data-view={prefs.view}
    >
      <header className="lib-list-head">
        <h1
          id={`lib-list-title-${placeKey}`}
          className="lib-list-title"
          tabIndex={-1}
        >
          {placeIcon(place)}
          <bdi dir="auto">{title}</bdi>
        </h1>
        <span className="lib-list-count" aria-live="polite" dir="auto">
          {filtering
            ? `${result.shown} of ${result.total}`
            : place.kind === "trash"
              ? `${result.total} ${result.total === 1 ? "item" : "items"}`
              : null}
        </span>
        {place.kind === "trash" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={restorable.length === 0}
            onClick={() =>
              restore(
                restorable.flatMap((row) =>
                  row.kind === "trash" ? [row.item] : [],
                ),
              )
            }
          >
            <ArchiveRestoreIcon aria-hidden="true" />
            Restore
          </Button>
        ) : null}
        {sorts.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`View options, sorted by ${SORT_LABELS[prefs.sort]}`}
                  title="View options"
                />
              }
            >
              <SlidersHorizontalIcon aria-hidden="true" />
              <span className="lib-list-sortlabel">
                {SORT_LABELS[prefs.sort]}
              </span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="lib-menu">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Sort by</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={prefs.sort}
                  onValueChange={(value) => {
                    const sort = value as ListSortField;
                    setPrefs({ sort, descending: defaultDescending(sort) });
                  }}
                >
                  {sorts.map((sort) => (
                    <DropdownMenuRadioItem key={sort} value={sort}>
                      {place.kind === "pinned" && sort === "manual"
                        ? "Pin order"
                        : SORT_LABELS[sort]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              {prefs.sort !== "manual" ? (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Order</DropdownMenuLabel>
                    <DropdownMenuRadioGroup
                      value={prefs.descending ? "desc" : "asc"}
                      onValueChange={(value) =>
                        setPrefs({
                          sort: prefs.sort,
                          descending: value === "desc",
                        })
                      }
                    >
                      <DropdownMenuRadioItem value="asc">
                        {directionLabels(prefs.sort)[0]}
                      </DropdownMenuRadioItem>
                      <DropdownMenuRadioItem value="desc">
                        {directionLabels(prefs.sort)[1]}
                      </DropdownMenuRadioItem>
                    </DropdownMenuRadioGroup>
                  </DropdownMenuGroup>
                </>
              ) : null}
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>View</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={prefs.view}
                  onValueChange={(value) =>
                    setPrefs({ view: value as ListViewPrefs["view"] })
                  }
                >
                  <DropdownMenuRadioItem value="list">
                    List
                  </DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="preview">
                    Preview
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuLabel>Group</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={prefs.group}
                  onValueChange={(value) =>
                    setPrefs({ group: value as ListViewPrefs["group"] })
                  }
                >
                  {groups.map((group) => (
                    <DropdownMenuRadioItem key={group} value={group}>
                      {GROUP_LABELS[group]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>

      <div className="lib-filterbar" role="search" aria-label="Filter list">
        <label className="lib-filter">
          <SearchIcon aria-hidden="true" />
          <input
            ref={filterRef}
            type="text"
            value={filterText}
            placeholder="Filter by title, tag or folder"
            aria-label="Filter by title, tag or folder"
            aria-keyshortcuts={mac ? "Meta+F" : "Control+F"}
            dir="auto"
            spellCheck={false}
            onChange={(event) => setFilterText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                if (filterText) setFilterText("");
                else focusRow(activeKey);
              } else if (event.key === "ArrowDown" || event.key === "Enter") {
                event.preventDefault();
                focusRow(activeKey ?? focusable[0]);
              }
            }}
          />
        </label>
        {place.kind !== "trash" && sortTags.length > 0 ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="outline" size="sm" />}
            >
              <TagIcon aria-hidden="true" />
              {filterTags.length > 0 ? `Tags (${filterTags.length})` : "Tags"}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="lib-menu">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Documents with all of</DropdownMenuLabel>
                {sortTags.map((tag) => (
                  <DropdownMenuCheckboxItem
                    key={tag.id}
                    checked={filterTags.includes(tag.id)}
                    disabled={place.kind === "tag" && place.id === tag.id}
                    onCheckedChange={(checked) =>
                      setFilterTags((current) =>
                        checked
                          ? [...current, tag.id]
                          : current.filter((id) => id !== tag.id),
                      )
                    }
                  >
                    <bdi dir="auto">{tag.name}</bdi>
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {place.kind !== "trash" ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={`Modified: ${SINCE[since].label}`}
                />
              }
            >
              <ClockIcon aria-hidden="true" />
              {SINCE[since].label}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="lib-menu">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Modified</DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={since}
                  onValueChange={(value) => setSince(value as Since)}
                >
                  {(Object.keys(SINCE) as Since[]).map((key) => (
                    <DropdownMenuRadioItem key={key} value={key}>
                      {SINCE[key].label}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        {chosenTags.length > 0 ? (
          <ul className="lib-chips" aria-label="Tag filters">
            {chosenTags.map((tag) => (
              <li key={tag.id} className="lib-tag-chip lib-tag-chip-filter">
                <bdi dir="auto">{tag.name}</bdi>
                <button
                  type="button"
                  aria-label={`Remove tag filter ${tag.name}`}
                  onClick={() =>
                    setFilterTags((current) =>
                      current.filter((id) => id !== tag.id),
                    )
                  }
                >
                  <CloseIcon aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div
        className="lib-grid"
        role="grid"
        aria-labelledby={`lib-list-title-${placeKey}`}
        aria-multiselectable="true"
        aria-rowcount={rows.length + 1}
        aria-colcount={folderColumn ? 3 : 2}
        data-folder-column={folderColumn ? "" : undefined}
      >
        <div role="rowgroup" className="lib-grid-head">
          <div role="row" aria-rowindex={1} className="lib-lrow lib-lhead">
            <div role="columnheader" aria-sort={ariaSort("title")}>
              <button
                type="button"
                className="lib-colbtn"
                tabIndex={-1}
                disabled={place.kind === "trash"}
                onClick={() => sortBy("title")}
              >
                Name
                {ariaSort("title") ? sortArrow(prefs.descending) : null}
              </button>
            </div>
            {folderColumn ? (
              <div role="columnheader" className="lib-lcell-folder">
                <span className="lib-colbtn">
                  {place.kind === "trash" ? "Original location" : "Folder"}
                </span>
              </div>
            ) : null}
            <div
              role="columnheader"
              aria-sort={ariaSort("date")}
              className="lib-lcell-date"
            >
              <button
                type="button"
                className="lib-colbtn"
                tabIndex={-1}
                disabled={place.kind === "trash"}
                onClick={() => sortBy("date")}
              >
                {dateLabel}
                {ariaSort("date") ? sortArrow(prefs.descending) : null}
              </button>
            </div>
          </div>
        </div>
        <div
          ref={body}
          role="rowgroup"
          className="lib-grid-body"
          onScroll={(event) => {
            const top = event.currentTarget.scrollTop;
            setScrollTop(top);
            remember(top);
          }}
          onKeyDown={onKeyDown}
          onFocus={(event) => {
            const key = (event.target as HTMLElement).getAttribute("data-key");
            if (key && key !== focusKey) setFocusKey(key);
          }}
          onClick={(event) => {
            const key = keyOfEvent(event);
            const row = key ? rowByKey(key) : undefined;
            if (!row || row.kind === "group" || renaming === key) return;
            setFocusKey(row.key);
            setSelected(new Set([row.key]));
            anchorKey.current = row.key;
            open(row, event);
          }}
          onAuxClick={(event) => {
            const key = keyOfEvent(event);
            const row = key ? rowByKey(key) : undefined;
            if (event.button === 1 && row?.kind === "doc") {
              actions.open(row.id, "tab");
            }
          }}
          onContextMenu={(event) => {
            const key = keyOfEvent(event);
            const row = key ? rowByKey(key) : undefined;
            if (!row || row.kind === "group") return;
            event.preventDefault();
            setFocusKey(row.key);
            if (!selected.has(row.key)) setSelected(new Set([row.key]));
            menuFor(row, { x: event.clientX, y: event.clientY });
          }}
        >
          <div
            className="lib-grid-sizer"
            role="presentation"
            style={{ height: total }}
          >
            {mounted.map((at) => {
              const row = rows[at];
              return (
                <ListRowView
                  key={row.key}
                  row={row}
                  rowIndex={at + 2}
                  style={{ top: offsets[at], height: heights[at] }}
                  selected={selected.has(row.key)}
                  focused={row.key === activeKey}
                  preview={preview}
                  folderColumn={folderColumn}
                  now={now}
                  renaming={renaming === row.key}
                  onRenameDone={onRenameDone}
                />
              );
            })}
          </div>
          {empty ? (
            <EmptyState
              place={place}
              filtering={filtering}
              title={title}
              onCreate={() =>
                actions.createDocument(
                  place.kind === "folder" ? place.id : null,
                )
              }
            />
          ) : null}
        </div>
      </div>
      {place.kind === "trash" && !empty ? (
        <footer className="lib-list-foot" dir="auto">
          Documents in Trash are deleted after 30 days.
        </footer>
      ) : null}
      {menu ? (
        <EntryMenu
          anchor={menu.anchor}
          entries={[
            {
              id: "restore",
              label:
                menu.items.length > 1
                  ? `Restore ${menu.items.length} Items`
                  : "Restore",
              run: () => restore(menu.items),
            },
          ]}
          movesFocus={() => true}
          onClose={(keepFocus) => {
            setMenu(null);
            if (!keepFocus) focusRow(activeKey, false);
          }}
        />
      ) : null}
    </section>
  );
}

function EmptyState({
  place,
  filtering,
  title,
  onCreate,
}: {
  place: LibraryPlace;
  filtering: boolean;
  title: string;
  onCreate: () => void;
}) {
  if (filtering) {
    return (
      <div className="lib-empty" role="status">
        <SearchIcon aria-hidden="true" />
        <p className="lib-empty-title">No matches</p>
        <p className="lib-empty-text">
          The filter looks at titles, tags and folders, not inside documents.
        </p>
      </div>
    );
  }
  const copy = emptyCopy(place, title);
  return (
    <div className="lib-empty" role="status">
      {copy.icon}
      <p className="lib-empty-title">{copy.title}</p>
      <p className="lib-empty-text">{copy.text}</p>
      {copy.create ? (
        <Button onClick={onCreate}>
          <FilePlusIcon aria-hidden="true" />
          New Document
        </Button>
      ) : null}
    </div>
  );
}

function sortArrow(descending: boolean) {
  return descending ? (
    <ArrowDownIcon aria-hidden="true" className="lib-sortarrow" />
  ) : (
    <ArrowUpIcon aria-hidden="true" className="lib-sortarrow" />
  );
}

function placeIcon(place: LibraryPlace) {
  switch (place.kind) {
    case "recent":
      return <ClockIcon aria-hidden="true" />;
    case "pinned":
      return <PinIcon aria-hidden="true" />;
    case "trash":
      return <TrashIcon aria-hidden="true" />;
    case "tag":
      return <TagIcon aria-hidden="true" />;
    case "folder":
      return <FolderIcon aria-hidden="true" />;
    default:
      return <LibraryIcon aria-hidden="true" />;
  }
}

/** The list's heading. */
export function placeTitle(
  place: LibraryPlace,
  snapshot: {
    readonly folders: readonly { id: string; name: string }[];
    readonly tags: readonly { id: string; name: string }[];
  },
): string {
  switch (place.kind) {
    case "folder":
      return (
        snapshot.folders.find((folder) => folder.id === place.id)?.name ??
        "Folder"
      );
    case "tag":
      return snapshot.tags.find((tag) => tag.id === place.id)?.name ?? "Tag";
    case "recent":
      return "Recent";
    case "pinned":
      return "Pinned";
    case "trash":
      return "Trash";
    default:
      return "Library";
  }
}

/** UX §5.2 empty states. */
function emptyCopy(
  place: LibraryPlace,
  title: string,
): { icon: ReactNode; title: string; text: string; create: boolean } {
  switch (place.kind) {
    case "trash":
      return {
        icon: <TrashIcon aria-hidden="true" />,
        title: "Trash is empty",
        text: "Documents you delete stay here for 30 days.",
        create: false,
      };
    case "recent":
      return {
        icon: <ClockIcon aria-hidden="true" />,
        title: "Nothing opened yet",
        text: "Documents you open appear here.",
        create: true,
      };
    case "pinned":
      return {
        icon: <PinIcon aria-hidden="true" />,
        title: "No pinned documents",
        text: "Pin a document to keep it here.",
        create: false,
      };
    case "tag":
      return {
        icon: <TagIcon aria-hidden="true" />,
        title: `No documents tagged “${title}”`,
        text: "Documents with this tag appear here.",
        create: false,
      };
    case "folder":
      return {
        icon: <FolderIcon aria-hidden="true" />,
        title: `“${title}” is empty`,
        text: "Drag documents here, or create one.",
        create: true,
      };
    default:
      return {
        icon: <LibraryIcon aria-hidden="true" />,
        title: "No documents yet",
        text: "Documents you create or import appear here.",
        create: true,
      };
  }
}
