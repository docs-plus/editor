/**
 * List places and their saved choices (details spec §6.3, UX §4.1): which
 * sorts, views and groups a place offers, its defaults, and how the
 * choices map to the desktop engine's `folders.sort`, `view` and `"group"`
 * columns (the other places keep theirs in `meta`).
 */
import type {
  ListSortField,
  ListViewPrefs,
} from "@/lib/platform/document-index";

/** A list the host shows in the main area (UX §4.1). */
export type LibraryPlace =
  | { kind: "recent" }
  | { kind: "pinned" }
  | { kind: "library" }
  | { kind: "trash" }
  | { kind: "folder"; id: string }
  | { kind: "tag"; id: string };

export function listPlaceKey(place: LibraryPlace): string {
  return "id" in place ? `${place.kind}:${place.id}` : place.kind;
}

const DATE_SORTS: readonly ListSortField[] = ["modified", "created", "opened"];
const ALL_SORTS: readonly ListSortField[] = ["title", ...DATE_SORTS, "manual"];
const NO_MANUAL: readonly ListSortField[] = ["title", ...DATE_SORTS];

export function sortOptions(place: LibraryPlace): readonly ListSortField[] {
  switch (place.kind) {
    case "library":
    case "folder":
    case "pinned":
      return ALL_SORTS;
    case "trash":
      return [];
    default:
      return NO_MANUAL;
  }
}

export function groupOptions(
  place: LibraryPlace,
): readonly ListViewPrefs["group"][] {
  switch (place.kind) {
    case "recent":
    case "pinned":
    case "tag":
      return ["none", "date", "folder"];
    case "trash":
      return ["none"];
    default:
      return ["none", "date"];
  }
}

/** Dates sort newest first when picked; title and Manual ascending. */
export function defaultDescending(sort: ListSortField): boolean {
  return DATE_SORTS.includes(sort);
}

function defaults(place: LibraryPlace): ListViewPrefs {
  switch (place.kind) {
    case "recent":
      return {
        sort: "modified",
        descending: true,
        view: "list",
        group: "date",
      };
    case "pinned":
      return { sort: "manual", descending: false, view: "list", group: "none" };
    default:
      return { sort: "title", descending: false, view: "list", group: "none" };
  }
}

const VIEWS: readonly ListViewPrefs["view"][] = ["list", "preview"];
const GROUPS: readonly ListViewPrefs["group"][] = ["none", "date", "folder"];

/** Only the fields with known values. */
export function cleanListViewPrefs(
  prefs: Partial<ListViewPrefs>,
): Partial<ListViewPrefs> {
  const clean: { -readonly [K in keyof ListViewPrefs]?: ListViewPrefs[K] } = {};
  if (ALL_SORTS.includes(prefs.sort as ListSortField)) clean.sort = prefs.sort;
  if (typeof prefs.descending === "boolean") {
    clean.descending = prefs.descending;
  }
  if (VIEWS.includes(prefs.view as ListViewPrefs["view"])) {
    clean.view = prefs.view;
  }
  if (GROUPS.includes(prefs.group as ListViewPrefs["group"])) {
    clean.group = prefs.group;
  }
  return clean;
}

/** The place's choices: what was saved for it, else its defaults. */
export function resolveListView(
  place: LibraryPlace,
  saved: Readonly<Record<string, Partial<ListViewPrefs>>>,
): ListViewPrefs {
  const base = defaults(place);
  const own = cleanListViewPrefs(saved[listPlaceKey(place)] ?? {});
  const sort =
    own.sort && sortOptions(place).includes(own.sort) ? own.sort : base.sort;
  return {
    sort,
    descending:
      sort === own.sort
        ? (own.descending ?? defaultDescending(sort))
        : base.descending,
    view: place.kind === "trash" ? "list" : (own.view ?? base.view),
    group:
      own.group && groupOptions(place).includes(own.group)
        ? own.group
        : base.group,
  };
}

/** `folders` row values; null where nothing was chosen. */
export interface ListViewColumns {
  readonly sort: string | null;
  readonly view: string | null;
  readonly group: string | null;
}

export function encodeListViewColumns(
  prefs: Partial<ListViewPrefs>,
): ListViewColumns {
  const clean = cleanListViewPrefs(prefs);
  return {
    sort: clean.sort
      ? `${clean.sort} ${(clean.descending ?? defaultDescending(clean.sort)) ? "desc" : "asc"}`
      : null,
    view: clean.view ?? null,
    group: clean.group ?? null,
  };
}

export function decodeListViewColumns(
  columns: ListViewColumns,
): Partial<ListViewPrefs> {
  const [sort, direction] = (columns.sort ?? "").split(" ");
  const descending =
    direction === "desc" ? true : direction === "asc" ? false : undefined;
  const clean = cleanListViewPrefs({
    sort: sort as ListSortField,
    descending,
    view: (columns.view ?? undefined) as ListViewPrefs["view"],
    group: (columns.group ?? undefined) as ListViewPrefs["group"],
  });
  if (!clean.sort) {
    const { descending: _drop, ...rest } = clean;
    return rest;
  }
  return clean;
}
