/**
 * Quick Open matching (UX §4.3, search-linking §3.1–3.2, D24): metadata
 * only, never body text. Every query term must match the title or a folder
 * on the document's path; title matches rank first, word prefixes before
 * substrings, and ties go to the most recently opened. Tags join with
 * P2.7b/SR1, and operators (`tag:`, `in:`) with SR1.
 */
import { folderPath, indexFolders } from "@/lib/library/folder-rules";
import { entryTitle, nameCollator } from "@/lib/library/tree-rows";
import type { DocumentEntry, FolderEntry } from "@/lib/platform/document-index";
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

export interface QuickOpenResult {
  readonly id: string;
  /** As shown: "Untitled" for a blank title. */
  readonly title: string;
  /** Matched parts of `title`, for bold. */
  readonly titleRanges: readonly Range[];
  /** Folder names from the root; empty at the Library root. */
  readonly path: readonly string[];
  /** Matched parts of each `path` name. */
  readonly pathRanges: readonly (readonly Range[])[];
  /** A term matched only a folder name. */
  readonly matchedFolder: boolean;
  readonly openedAt: number;
}

interface Candidate extends QuickOpenResult {
  readonly tier: number;
}

export const QUICK_OPEN_LIMIT = 50;
export const QUICK_OPEN_RECENT = 8;

function byRecency(a: QuickOpenResult, b: QuickOpenResult): number {
  return b.openedAt - a.openedAt || nameCollator.compare(a.title, b.title);
}

export function searchDocuments(
  library: {
    readonly items: readonly DocumentEntry[];
    readonly folders: readonly FolderEntry[];
  },
  query: string,
  options: { limit?: number } = {},
): QuickOpenResult[] {
  const terms = queryTerms(query);
  const folders = indexFolders(library.folders);
  const paths = new Map<string | null, FolderEntry[]>();
  const pathOf = (id: string | null) => {
    let path = paths.get(id);
    if (!path) {
      path = folderPath(folders, id);
      paths.set(id, path);
    }
    return path;
  };
  const folderText = new Map<string, NormalizedText>();
  const normalizedName = (folder: FolderEntry) => {
    let text = folderText.get(folder.id);
    if (!text) {
      text = normalizeWithOffsets(folder.name);
      folderText.set(folder.id, text);
    }
    return text;
  };

  if (terms.length === 0) {
    return library.items
      .filter((item) => item.openedAt !== undefined)
      .map((item) => {
        const path = pathOf(item.folderId ?? null);
        return {
          id: item.id,
          title: entryTitle(item),
          titleRanges: [],
          path: path.map((folder) => folder.name),
          pathRanges: path.map(() => []),
          matchedFolder: false,
          openedAt: item.openedAt ?? 0,
        };
      })
      .sort(byRecency)
      .slice(0, options.limit ?? QUICK_OPEN_RECENT);
  }

  const results: Candidate[] = [];
  for (const item of library.items) {
    const title = entryTitle(item);
    const normalizedTitle = normalizeWithOffsets(title);
    const path = pathOf(item.folderId ?? null);
    const titleHits: TermHit[] = [];
    const folderHits: TermHit[][] = path.map(() => []);
    let tier = 0;
    let matched = true;
    for (const term of terms) {
      const inTitle = findTerm(term, normalizedTitle.text);
      if (inTitle) {
        titleHits.push(inTitle);
        tier = Math.max(tier, inTitle.prefix ? 0 : 1);
        continue;
      }
      let found: { at: number; hit: TermHit } | null = null;
      for (let at = 0; at < path.length; at++) {
        const hit = findTerm(term, normalizedName(path[at]).text);
        if (hit && (!found || (hit.prefix && !found.hit.prefix))) {
          found = { at, hit };
        }
      }
      if (!found) {
        matched = false;
        break;
      }
      folderHits[found.at].push(found.hit);
      tier = Math.max(tier, found.hit.prefix ? 2 : 3);
    }
    if (!matched) continue;
    results.push({
      id: item.id,
      title,
      titleRanges: sourceRanges(normalizedTitle, titleHits),
      path: path.map((folder) => folder.name),
      pathRanges: path.map((folder, at) =>
        sourceRanges(normalizedName(folder), folderHits[at]),
      ),
      matchedFolder: tier >= 2,
      openedAt: item.openedAt ?? 0,
      tier,
    });
  }
  return results
    .sort((a, b) => a.tier - b.tier || byRecency(a, b))
    .slice(0, options.limit ?? QUICK_OPEN_LIMIT)
    .map(({ tier: _tier, ...result }) => result);
}
