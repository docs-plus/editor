/**
 * Sharing a document turns its links to documents that aren't shared into
 * plain text by default (D-O8; search-linking §4.4 "Shared (Live)", §4.7,
 * §8). [Keep Links] in the consent window skips this. Pure: works on a bare
 * Y.Doc, no editor.
 *
 * Every link of ours goes except `here#` links and links to shared
 * documents: hrefs that don't parse (an invalid or later form) go too, since
 * they may still carry a real key, and a share must never send one. Web links,
 * the text and every other mark stay as they are. `countPrivateDocLinks` is
 * the same walk without writing, so the consent line counts exactly what
 * the strip will do.
 */
import * as Y from "yjs";

import { isOurScheme, parseDocLink } from "@/lib/links/doc-link";

/** y-tiptap stores a self-excluding mark under its name (extract-links). */
const LINK_MARK = "hyperlink";

interface DeltaItem {
  readonly insert?: unknown;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

interface Strip {
  readonly text: Y.XmlText;
  readonly index: number;
  readonly length: number;
}

/** The href when `item` is a link of ours that must not be shared. */
function privateHref(
  item: DeltaItem,
  sharedKeys: ReadonlySet<string>,
): string | null {
  const mark = item.attributes?.[LINK_MARK];
  if (typeof mark !== "object" || mark === null || !("href" in mark)) {
    return null;
  }
  const { href } = mark;
  if (typeof href !== "string" || !isOurScheme(href)) return null;
  const link = parseDocLink(href);
  if (link?.kind === "here") return null;
  if (link?.kind === "doc" && sharedKeys.has(link.key)) return null;
  return href;
}

/**
 * Collects the runs to strip under `element`. Adjacent items with the same
 * href are one link (a link split by bold), as in `extract-links`; an inline
 * atom (hard break, media) or other text ends it. Returns the link count.
 */
function collect(
  element: Y.XmlElement | Y.XmlFragment,
  sharedKeys: ReadonlySet<string>,
  strips: Strip[],
): number {
  let count = 0;
  let previous: string | null = null;
  for (const child of element.toArray()) {
    if (child instanceof Y.XmlText) {
      let index = 0;
      for (const item of child.toDelta() as DeltaItem[]) {
        if (typeof item.insert !== "string") {
          index += 1;
          previous = null;
          continue;
        }
        const length = item.insert.length;
        const href = privateHref(item, sharedKeys);
        if (href !== null) {
          strips.push({ text: child, index, length });
          if (href !== previous) count++;
        }
        previous = href;
        index += length;
      }
    } else {
      previous = null;
      if (child instanceof Y.XmlElement) {
        count += collect(child, sharedKeys, strips);
      }
    }
  }
  return count;
}

/**
 * Removes the `hyperlink` mark from every link to a document whose link key
 * isn't in `sharedKeys`, in one Yjs transaction (none when there is nothing
 * to strip). Returns how many links became plain text.
 */
/** How many links `stripPrivateDocLinks` would turn into plain text. */
export function countPrivateDocLinks(
  fragment: Y.XmlFragment,
  sharedKeys: ReadonlySet<string>,
): number {
  return collect(fragment, sharedKeys, []);
}

export function stripPrivateDocLinks(
  fragment: Y.XmlFragment,
  sharedKeys: ReadonlySet<string>,
): number {
  const strips: Strip[] = [];
  const count = collect(fragment, sharedKeys, strips);
  if (strips.length === 0) return 0;
  const apply = () => {
    // Formatting never shifts offsets, so the order doesn't matter.
    for (const { text, index, length } of strips) {
      text.format(index, length, { [LINK_MARK]: null });
    }
  };
  if (fragment.doc) fragment.doc.transact(apply);
  else apply();
  return count;
}
