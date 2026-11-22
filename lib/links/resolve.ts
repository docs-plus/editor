/**
 * Where a document link points, read from the library index snapshot the
 * renderer already holds (search-linking §4.4, §4.6). Sync and cheap: the
 * `linkIcon` resolver calls it on every link render, so the key → entry map
 * is built once per snapshot object (snapshots keep their identity until
 * something changes, `DocumentIndex` contract).
 */
import { folderPath, indexFolders } from "@/lib/library/folder-rules";
import { entryTitle } from "@/lib/library/tree-rows";
import { isOurScheme, parseDocLink } from "@/lib/links/doc-link";
import type { DocumentEntry, FolderEntry } from "@/lib/platform/document-index";

export type LinkState =
  | {
      readonly state: "resolves";
      readonly docId: string;
      readonly title: string;
      /** Folder names from the Library root down to the document's folder. */
      readonly path: readonly string[];
      readonly tocId: string | null;
    }
  | {
      readonly state: "in_trash";
      readonly docId: string;
      readonly title: string;
      readonly tocId: string | null;
    }
  | { readonly state: "deleted" }
  | { readonly state: "not_in_library" }
  | { readonly state: "unknown_form" }
  | { readonly state: "here"; readonly tocId: string };

export type LinkStateName = LinkState["state"];

/** The parts of a `LibraryIndexSnapshot` links read. */
export interface LinkIndexSnapshot {
  readonly items: readonly DocumentEntry[];
  readonly folders?: readonly FolderEntry[];
  readonly trashed?: readonly DocumentEntry[];
}

export interface LinkSource {
  readonly snapshot: LinkIndexSnapshot;
  /**
   * Link keys of documents purged from this library. No index keeps a
   * purge record yet, so today every unknown key reads as
   * `not_in_library`; a host that learns of purges passes them here.
   */
  readonly purgedKeys?: ReadonlySet<string>;
}

interface ResolvedEntry {
  readonly entry: DocumentEntry;
  readonly trashed: boolean;
}

interface SnapshotLookup {
  readonly byKey: ReadonlyMap<string, ResolvedEntry>;
  readonly folders: ReturnType<typeof indexFolders>;
}

const lookups = new WeakMap<LinkIndexSnapshot, SnapshotLookup>();

function lookupFor(snapshot: LinkIndexSnapshot): SnapshotLookup {
  const cached = lookups.get(snapshot);
  if (cached) return cached;
  const byKey = new Map<string, ResolvedEntry>();
  // Trashed first, so a live entry with the same key (not expected) wins.
  for (const entry of snapshot.trashed ?? []) {
    if (entry.linkKey) byKey.set(entry.linkKey, { entry, trashed: true });
  }
  for (const entry of snapshot.items) {
    if (entry.linkKey) byKey.set(entry.linkKey, { entry, trashed: false });
  }
  const lookup = { byKey, folders: indexFolders(snapshot.folders ?? []) };
  lookups.set(snapshot, lookup);
  return lookup;
}

/** Null when `href` isn't a `tinydocy:` link at all. */
export function resolveDocLink(
  href: string,
  source: LinkSource,
): LinkState | null {
  if (!isOurScheme(href)) return null;
  const link = parseDocLink(href);
  if (!link) return { state: "unknown_form" };
  if (link.kind === "here") return { state: "here", tocId: link.tocId };

  const lookup = lookupFor(source.snapshot);
  const found = lookup.byKey.get(link.key);
  if (!found) {
    return source.purgedKeys?.has(link.key)
      ? { state: "deleted" }
      : { state: "not_in_library" };
  }
  const { entry, trashed } = found;
  const title = entryTitle(entry);
  if (trashed) {
    return { state: "in_trash", docId: entry.id, title, tocId: link.tocId };
  }
  const path = folderPath(lookup.folders, entry.folderId ?? null).map(
    (folder) => folder.name,
  );
  return {
    state: "resolves",
    docId: entry.id,
    title,
    path,
    tocId: link.tocId,
  };
}
