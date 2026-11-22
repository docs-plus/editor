/**
 * The rows of a list view (details spec §6.3, UX §4.1): what a place lists,
 * the filter bar (metadata only, D24: titles, tags and folder names, never
 * the snippet), sort, and grouping by date or folder. One flat array with
 * group headers, so the list can window it. Pure, with the clock passed in.
 */
import { folderPath, indexFolders } from "@/lib/library/folder-rules";
import type { LibraryPlace } from "@/lib/library/list-view";
import { entryTitle, nameCollator } from "@/lib/library/tree-rows";
import type {
  DocumentEntry,
  FolderEntry,
  LibraryIndexSnapshot,
  ListSortField,
  ListViewPrefs,
  TagEntry,
  TrashedItem,
} from "@/lib/platform/document-index";
import {
  findTerm,
  queryTerms,
  sourceRanges,
  type TermHit,
} from "@/lib/search/match";
import {
  type NormalizedText,
  normalizeWithOffsets,
} from "@/lib/search/normalize";

export type Range = [start: number, end: number];

export type ListRow =
  | {
      readonly kind: "group";
      readonly key: string;
      readonly label: string;
    }
  | {
      readonly kind: "folder";
      /** `folder:<id>`, as in the tree (`itemKey`). */
      readonly key: string;
      readonly id: string;
      readonly name: string;
      readonly nameRanges: readonly Range[];
    }
  | {
      readonly kind: "doc";
      /** `doc:<id>`, as in the tree (`itemKey`). */
      readonly key: string;
      readonly id: string;
      readonly entry: DocumentEntry;
      /** As shown: "Untitled" for a blank title. */
      readonly title: string;
      readonly titleRanges: readonly Range[];
      /** Folder names from the root; empty at the Library root. */
      readonly path: readonly string[];
      /** The date column: the sort's date, else Modified. */
      readonly date: number | undefined;
      /** By name. */
      readonly tags: readonly TagEntry[];
    }
  | {
      readonly kind: "trash";
      /** `trash:doc:<id>` or `trash:folder:<id>`. */
      readonly key: string;
      readonly item: TrashedItem;
      readonly label: string;
      readonly labelRanges: readonly Range[];
      /** Where it was: a folder path, or "Library". */
      readonly location: string;
    };

export interface ListFilter {
  /** Filter bar text; every term must match the title, a tag or a folder. */
  readonly text: string;
  /** Tags the documents must all have (AND). */
  readonly tagIds: readonly string[];
  /** Only documents modified at or after this time. */
  readonly since?: number | null;
}

export interface ListRowsInput {
  readonly snapshot: LibraryIndexSnapshot;
  readonly place: LibraryPlace;
  readonly prefs: ListViewPrefs;
  readonly filter: ListFilter;
  readonly now: number;
  /** The locale's first day of the week, 0 (Sunday) to 6; default Monday. */
  readonly weekStart?: number;
}

export interface ListRowsResult {
  readonly rows: ListRow[];
  /** Documents (or Trash items) the place has before filtering. */
  readonly total: number;
  /** Rows that are not group headers. */
  readonly shown: number;
}

export const LIBRARY_LABEL = "Library";
const PATH_SEPARATOR = " › ";

// Entries are replaced on every change, so a cache by object stays right.
const normalizedTitles = new WeakMap<DocumentEntry, NormalizedText>();
function normalizedTitle(entry: DocumentEntry): NormalizedText {
  let text = normalizedTitles.get(entry);
  if (!text) {
    text = normalizeWithOffsets(entryTitle(entry));
    normalizedTitles.set(entry, text);
  }
  return text;
}

/** Manual order: sort keys first (string order), then the rest oldest first. */
export function compareManual(a: DocumentEntry, b: DocumentEntry): number {
  const x = a.sortKey ?? "";
  const y = b.sortKey ?? "";
  if (x && !y) return -1;
  if (!x && y) return 1;
  if (x !== y) return x < y ? -1 : 1;
  return a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** The Manual key for the 0-based `position` in a renumbered folder. */
export function manualKeyAt(position: number): string {
  return `m${String(position + 1).padStart(6, "0")}`;
}

/**
 * The key a document gets when it joins a folder: after the last keyed
 * sibling, or none while no sibling has one (it then sorts last by age).
 */
export function appendedManualKey(
  siblings: readonly DocumentEntry[],
): string | undefined {
  let last = "";
  for (const sibling of siblings) {
    if (sibling.sortKey && sibling.sortKey > last) last = sibling.sortKey;
  }
  if (!last) return undefined;
  const count = siblings.filter((sibling) => sibling.sortKey).length;
  const next = manualKeyAt(count);
  return next > last ? next : `${last}0`;
}

/** Renumbers `ids` (a folder's documents in their new order). */
export function renumberManual(
  ids: readonly string[],
): ReadonlyMap<string, string> {
  return new Map(ids.map((id, at) => [id, manualKeyAt(at)]));
}

function comparePin(a: DocumentEntry, b: DocumentEntry): number {
  const x = a.pinKey ?? "";
  const y = b.pinKey ?? "";
  return x === y ? 0 : x < y ? -1 : 1;
}

function byTitle(a: DocumentEntry, b: DocumentEntry): number {
  return (
    nameCollator.compare(entryTitle(a), entryTitle(b)) ||
    a.createdAt - b.createdAt ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function sortDate(
  entry: DocumentEntry,
  field: ListSortField,
): number | undefined {
  switch (field) {
    case "created":
      return entry.createdAt;
    case "opened":
      return entry.openedAt;
    default:
      return entry.modifiedAt ?? entry.createdAt;
  }
}

function isDateSort(field: ListSortField): boolean {
  return field === "modified" || field === "created" || field === "opened";
}

function comparator(
  place: LibraryPlace,
  prefs: ListViewPrefs,
): (a: DocumentEntry, b: DocumentEntry) => number {
  const sign = prefs.descending ? -1 : 1;
  if (prefs.sort === "title") return (a, b) => sign * byTitle(a, b);
  if (prefs.sort === "manual") {
    const manual = place.kind === "pinned" ? comparePin : compareManual;
    return (a, b) => sign * manual(a, b);
  }
  const field = prefs.sort;
  return (a, b) => {
    const x = sortDate(a, field);
    const y = sortDate(b, field);
    // Never opened: last whichever way.
    if (x === undefined || y === undefined) {
      if (x !== y) return x === undefined ? 1 : -1;
      return byTitle(a, b);
    }
    return sign * (x - y) || byTitle(a, b);
  };
}

export type DateBucket =
  | "today"
  | "yesterday"
  | "week"
  | "month"
  | "earlier"
  | "never";

const BUCKET_LABELS: Record<DateBucket, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "This week",
  month: "This month",
  earlier: "Earlier",
  never: "Never opened",
};
const BUCKET_ORDER: readonly DateBucket[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "earlier",
];

/** Local calendar buckets; a future time (clock skew) counts as today. */
export function dateBucket(
  time: number | undefined,
  now: number,
  weekStart = 1,
): DateBucket {
  if (time === undefined) return "never";
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const todayStart = today.getTime();
  if (time >= todayStart) return "today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (time >= yesterday.getTime()) return "yesterday";
  const week = new Date(today);
  week.setDate(today.getDate() - ((today.getDay() - weekStart + 7) % 7));
  if (time >= week.getTime()) return "week";
  const month = new Date(today);
  month.setDate(1);
  if (time >= month.getTime()) return "month";
  return "earlier";
}

interface DocMatch {
  readonly titleRanges: readonly Range[];
}

/**
 * Matches every term against the title, then the tag names, then the folder
 * names on the path (D24); null when a term matches none.
 */
function matchDoc(
  entry: DocumentEntry,
  terms: readonly string[],
  tagText: (id: string) => string,
  pathText: (folderId: string | null) => readonly string[],
): DocMatch | null {
  if (terms.length === 0) return { titleRanges: [] };
  const title = normalizedTitle(entry);
  const hits: TermHit[] = [];
  for (const term of terms) {
    const hit = findTerm(term, title.text);
    if (hit) {
      hits.push(hit);
      continue;
    }
    const inTag = (entry.tagIds ?? []).some((id) => tagText(id).includes(term));
    if (inTag) continue;
    const inPath = pathText(entry.folderId ?? null).some((name) =>
      name.includes(term),
    );
    if (!inPath) return null;
  }
  return { titleRanges: sourceRanges(title, hits) };
}

function matchName(
  name: string,
  terms: readonly string[],
): readonly Range[] | null {
  if (terms.length === 0) return [];
  const text = normalizeWithOffsets(name);
  const hits: TermHit[] = [];
  for (const term of terms) {
    const hit = findTerm(term, text.text);
    if (!hit) return null;
    hits.push(hit);
  }
  return sourceRanges(text, hits);
}

function placeDocs(
  snapshot: LibraryIndexSnapshot,
  place: LibraryPlace,
): DocumentEntry[] {
  switch (place.kind) {
    case "library":
      return snapshot.items.filter((doc) => (doc.folderId ?? null) === null);
    case "folder":
      return snapshot.items.filter((doc) => doc.folderId === place.id);
    case "recent":
      return snapshot.items.filter((doc) => doc.openedAt !== undefined);
    case "pinned":
      return snapshot.items.filter((doc) => doc.pinKey !== undefined);
    case "tag":
      return snapshot.items.filter((doc) => doc.tagIds?.includes(place.id));
    default:
      return [];
  }
}

function placeFolders(
  snapshot: LibraryIndexSnapshot,
  place: LibraryPlace,
): FolderEntry[] {
  if (place.kind === "library") {
    return snapshot.folders.filter((folder) => folder.parentId === null);
  }
  if (place.kind === "folder") {
    return snapshot.folders.filter((folder) => folder.parentId === place.id);
  }
  return [];
}

export function buildListRows(input: ListRowsInput): ListRowsResult {
  const { snapshot, place, prefs, filter, now } = input;
  const terms = queryTerms(filter.text);
  const folders = indexFolders(snapshot.folders);
  const pathCache = new Map<string | null, FolderEntry[]>();
  const pathOf = (id: string | null) => {
    let path = pathCache.get(id);
    if (!path) {
      path = folderPath(folders, id);
      pathCache.set(id, path);
    }
    return path;
  };
  const pathLabel = (id: string | null) => {
    const path = pathOf(id);
    return path.length === 0
      ? LIBRARY_LABEL
      : path.map((folder) => folder.name).join(PATH_SEPARATOR);
  };

  if (place.kind === "trash") {
    const rows: ListRow[] = [];
    for (const item of [...snapshot.trash].sort(
      (a, b) => b.trashedAt - a.trashedAt,
    )) {
      const label = item.kind === "doc" ? entryTitle(item) : item.name;
      const labelRanges = matchName(label, terms);
      if (!labelRanges) continue;
      const from = item.kind === "doc" ? item.folderId : item.parentId;
      rows.push({
        kind: "trash",
        key: `trash:${item.kind}:${item.id}`,
        item,
        label,
        labelRanges,
        location: pathLabel(from),
      });
    }
    return { rows, total: snapshot.trash.length, shown: rows.length };
  }

  const tagsById = new Map(snapshot.tags.map((tag) => [tag.id, tag]));
  const tagTextCache = new Map<string, string>();
  const tagText = (id: string) => {
    let text = tagTextCache.get(id);
    if (text === undefined) {
      text = normalizeWithOffsets(tagsById.get(id)?.name ?? "").text;
      tagTextCache.set(id, text);
    }
    return text;
  };
  const pathTextCache = new Map<string | null, string[]>();
  const pathText = (id: string | null) => {
    let names = pathTextCache.get(id);
    if (!names) {
      names = pathOf(id).map(
        (folder) => normalizeWithOffsets(folder.name).text,
      );
      pathTextCache.set(id, names);
    }
    return names;
  };

  const docs = placeDocs(snapshot, place);
  const narrowed = filter.tagIds.length > 0 || filter.since != null;
  const folderRows: ListRow[] = [];
  if (!narrowed) {
    const sign = prefs.sort === "title" && prefs.descending ? -1 : 1;
    const sortedFolders = placeFolders(snapshot, place).sort(
      (a, b) => sign * nameCollator.compare(a.name, b.name),
    );
    for (const folder of sortedFolders) {
      const nameRanges = matchName(folder.name, terms);
      if (!nameRanges) continue;
      folderRows.push({
        kind: "folder",
        key: `folder:${folder.id}`,
        id: folder.id,
        name: folder.name,
        nameRanges,
      });
    }
  }

  const dateField: ListSortField = isDateSort(prefs.sort)
    ? prefs.sort
    : "modified";
  const matched: Array<{ entry: DocumentEntry; match: DocMatch }> = [];
  for (const entry of docs) {
    if (filter.tagIds.length > 0) {
      const own = entry.tagIds ?? [];
      if (!filter.tagIds.every((id) => own.includes(id))) continue;
    }
    if (
      filter.since != null &&
      (entry.modifiedAt ?? entry.createdAt) < filter.since
    ) {
      continue;
    }
    const match = matchDoc(entry, terms, tagText, pathText);
    if (match) matched.push({ entry, match });
  }
  const compare = comparator(place, prefs);
  matched.sort((a, b) => compare(a.entry, b.entry));

  const spansFolders =
    place.kind === "recent" || place.kind === "pinned" || place.kind === "tag";
  const docRow = ({ entry, match }: (typeof matched)[number]): ListRow => ({
    kind: "doc",
    key: `doc:${entry.id}`,
    id: entry.id,
    entry,
    title: entryTitle(entry),
    titleRanges: match.titleRanges,
    path: spansFolders
      ? pathOf(entry.folderId ?? null).map((folder) => folder.name)
      : [],
    date: sortDate(entry, dateField),
    tags: (entry.tagIds ?? [])
      .map((id) => tagsById.get(id))
      .filter((tag): tag is TagEntry => tag !== undefined)
      .sort((a, b) => nameCollator.compare(a.name, b.name)),
  });

  const rows: ListRow[] = [];
  if (prefs.group === "none") {
    rows.push(...folderRows, ...matched.map(docRow));
  } else {
    if (folderRows.length > 0) {
      rows.push({ kind: "group", key: "group:folders", label: "Folders" });
      rows.push(...folderRows);
    }
    const buckets = new Map<string, { label: string; rows: ListRow[] }>();
    for (const item of matched) {
      let id: string;
      let label: string;
      if (prefs.group === "folder") {
        id = item.entry.folderId ?? "";
        label = pathLabel(item.entry.folderId ?? null);
      } else {
        const bucket = dateBucket(
          sortDate(item.entry, dateField),
          now,
          input.weekStart,
        );
        id = bucket;
        label = BUCKET_LABELS[bucket];
      }
      let group = buckets.get(id);
      if (!group) {
        group = { label, rows: [] };
        buckets.set(id, group);
      }
      group.rows.push(docRow(item));
    }
    let order: string[];
    if (prefs.group === "folder") {
      order = [...buckets.keys()].sort((a, b) => {
        if (a === "" || b === "") return a === "" ? -1 : b === "" ? 1 : 0;
        return nameCollator.compare(
          buckets.get(a)?.label ?? "",
          buckets.get(b)?.label ?? "",
        );
      });
    } else {
      const oldestFirst = isDateSort(prefs.sort) && !prefs.descending;
      const known = oldestFirst ? [...BUCKET_ORDER].reverse() : BUCKET_ORDER;
      order = [...known, "never"].filter((id) => buckets.has(id));
    }
    for (const id of order) {
      const group = buckets.get(id);
      if (!group) continue;
      rows.push({ kind: "group", key: `group:${id}`, label: group.label });
      rows.push(...group.rows);
    }
  }
  return {
    rows,
    total: docs.length,
    shown: folderRows.length + matched.length,
  };
}
