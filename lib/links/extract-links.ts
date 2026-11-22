/**
 * The links-only pass (search-linking design §5). Walks an open document's
 * Yjs fragment and emits one row per document link (§4.1, `kind: "doc"`)
 * for the derived `links` table behind Linked from. It reads only the
 * `hyperlink` mark attributes and the text of the blocks that hold a
 * document link (as `context`); it builds no search index. `here#`,
 * external and malformed links are skipped.
 *
 * The same walk lists the headings (`extractHeadings`), and
 * `deriveDocument` returns both for the derive layer (offline data-model
 * revision §4: `links` and `doc_headings`; `toLinkRows` and `toHeadingRows`
 * map to their columns). Pure: no DOM, no storage; works on a bare Y.Doc.
 * `trackLinkChanges` (`link-dirty.ts`) says when a walk is needed at all.
 *
 * `linksHash` is for tests; the storage worker computes the stored hash.
 */
import * as Y from "yjs";

import { parseDocLink } from "@/lib/links/doc-link";

export interface LinkRow {
  /** `data-toc-id` of the section's heading; null when it has none. */
  readonly srcTocId: string | null;
  readonly key: string;
  readonly tocId: string | null;
  /** The link's text, up to `TEXT_MAX` characters. */
  readonly text: string;
  /** Up to `CONTEXT_MAX` characters of the block around the link. */
  readonly context: string;
}

/** y-tiptap stores a mark under its name when it excludes itself. */
const LINK_MARK = "hyperlink";
const TOC_ID_ATTR = "data-toc-id";
const CONTEXT_MAX = 160;
/**
 * Longest stored link text: a whole linked paragraph would otherwise land
 * in the row (and in the hash input) on every pass.
 */
export const TEXT_MAX = 200;
/** How far a cut may move back to the previous word boundary. */
const WORD_TRIM_MAX = 20;
const ELLIPSIS = "…";

interface Segment {
  readonly text: string;
  /** The href of a document link, or null for any other text. */
  readonly href: string | null;
}

interface Run {
  readonly href: string;
  readonly start: number;
  readonly end: number;
}

/**
 * Versions everything derived here (offline data-model revision §4.5): a
 * library whose stored `derive_version` differs re-derives every document.
 * Bump it whenever `deriveDocument`'s output changes for the same content.
 */
export const DERIVE_VERSION = 1;

/** A heading, for the `doc_headings` table (the worker adds `text_key`). */
export interface HeadingRow {
  /** Index in this document's list. */
  readonly ord: number;
  readonly tocId: string;
  /** 1 to 6. */
  readonly level: number;
  /** Its text, whitespace collapsed. */
  readonly text: string;
}

export interface DerivedDocument {
  readonly links: LinkRow[];
  readonly headings: HeadingRow[];
}

/**
 * One walk over the top-level blocks for both derived lists. Headings
 * without a `data-toc-id` yet are left out: nothing can link or jump to
 * them until the outline names them.
 */
export function deriveDocument(fragment: Y.XmlFragment): DerivedDocument {
  const links: LinkRow[] = [];
  const headings: HeadingRow[] = [];
  let srcTocId: string | null = null;
  for (const child of fragment.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === "heading") {
      srcTocId = tocIdOf(child);
      if (srcTocId !== null) {
        headings.push({
          ord: headings.length,
          tocId: srcTocId,
          level: levelOf(child),
          text: blockText(child),
        });
      }
    }
    collectBlock(child, srcTocId, links);
  }
  return { links, headings };
}

export function extractLinks(fragment: Y.XmlFragment): LinkRow[] {
  return deriveDocument(fragment).links;
}

export function extractHeadings(fragment: Y.XmlFragment): HeadingRow[] {
  return deriveDocument(fragment).headings;
}

/** A row of format 2's `links` table. */
export interface LinkTableRow {
  readonly src_doc_id: string;
  readonly ord: number;
  readonly src_toc_id: string;
  readonly target_key: string;
  readonly target_toc_id: string;
  readonly text: string;
  readonly context: string;
}

/** `extractLinks` rows as `links` columns: `ord` by index, `''` for null. */
export function toLinkRows(
  srcDocId: string,
  rows: readonly LinkRow[],
): LinkTableRow[] {
  return rows.map((row, ord) => ({
    src_doc_id: srcDocId,
    ord,
    src_toc_id: row.srcTocId ?? "",
    target_key: row.key,
    target_toc_id: row.tocId ?? "",
    text: row.text,
    context: row.context,
  }));
}

/** A row of format 2's `doc_headings` table, less the worker's `text_key`. */
export interface HeadingTableRow {
  readonly doc_id: string;
  readonly ord: number;
  readonly toc_id: string;
  readonly level: number;
  readonly text: string;
}

/** `extractHeadings` rows as `doc_headings` columns. */
export function toHeadingRows(
  docId: string,
  rows: readonly HeadingRow[],
): HeadingTableRow[] {
  return rows.map((row) => ({
    doc_id: docId,
    ord: row.ord,
    toc_id: row.tocId,
    level: row.level,
    text: row.text,
  }));
}

function levelOf(heading: Y.XmlElement): number {
  const level = Number(heading.getAttribute("level"));
  if (!Number.isFinite(level)) return 1;
  return Math.min(6, Math.max(1, Math.trunc(level)));
}

/** A text block's text: atoms read as a space, whitespace collapsed. */
function blockText(block: Y.XmlElement): string {
  let text = "";
  for (const child of block.toArray()) {
    if (child instanceof Y.XmlText) {
      for (const item of child.toDelta() as DeltaItem[]) {
        text += typeof item.insert === "string" ? item.insert : " ";
      }
    } else {
      text += " ";
    }
  }
  return text.replace(/\s+/g, " ").trim();
}

function tocIdOf(heading: Y.XmlElement): string | null {
  const id: unknown = heading.getAttribute(TOC_ID_ATTR);
  return typeof id === "string" && id !== "" ? id : null;
}

function collectBlock(
  block: Y.XmlElement,
  srcTocId: string | null,
  rows: LinkRow[],
): void {
  const children = block.toArray();
  if (children.some((child) => child instanceof Y.XmlText)) {
    collectTextBlock(children, srcTocId, rows);
    return;
  }
  for (const child of children) {
    if (child instanceof Y.XmlElement) collectBlock(child, srcTocId, rows);
  }
}

/**
 * A text block: XmlText runs between inline atoms (hard breaks, inline
 * media), which read as a space and end a link.
 */
function collectTextBlock(
  children: ReadonlyArray<Y.XmlElement | Y.XmlText | Y.XmlHook>,
  srcTocId: string | null,
  rows: LinkRow[],
): void {
  const segments: Segment[] = [];
  for (const child of children) {
    if (child instanceof Y.XmlText) {
      for (const item of child.toDelta() as DeltaItem[]) {
        if (typeof item.insert === "string") {
          segments.push({ text: item.insert, href: docLinkHref(item) });
        } else {
          segments.push({ text: " ", href: null });
        }
      }
    } else {
      segments.push({ text: " ", href: null });
    }
  }
  if (!segments.some((segment) => segment.href !== null)) return;

  // Adjacent segments with the same href are one run, so two links to the
  // same target written back to back become ONE row: the reader sees one
  // link, and the merge also rejoins a link split by bold or italic.
  // Different hrefs (even to one document) stay separate rows.
  const runs: Run[] = [];
  let text = "";
  for (const segment of segments) {
    const start = text.length;
    text += segment.text;
    if (segment.href === null) continue;
    const last = runs.at(-1);
    if (last && last.href === segment.href && last.end === start) {
      runs[runs.length - 1] = { ...last, end: text.length };
    } else {
      runs.push({ href: segment.href, start, end: text.length });
    }
  }

  for (const run of runs) {
    const link = parseDocLink(run.href);
    if (link?.kind !== "doc") continue;
    rows.push({
      srcTocId,
      key: link.key,
      tocId: link.tocId,
      text: capText(text.slice(run.start, run.end)),
      context: contextAround(text, run.start, run.end),
    });
  }
}

interface DeltaItem {
  readonly insert?: unknown;
  readonly attributes?: Readonly<Record<string, unknown>>;
}

function docLinkHref(item: DeltaItem): string | null {
  const mark = item.attributes?.[LINK_MARK];
  if (typeof mark !== "object" || mark === null || !("href" in mark)) {
    return null;
  }
  const { href } = mark;
  return typeof href === "string" && parseDocLink(href)?.kind === "doc"
    ? href
    : null;
}

/**
 * The link's text when it fits in `TEXT_MAX`; otherwise its start, cut
 * back to a word boundary near the end when one is close (never through a
 * surrogate pair), with `…` inside the cap.
 */
function capText(text: string): string {
  if (text.length <= TEXT_MAX) return text;
  let to = TEXT_MAX - ELLIPSIS.length;
  if (text[to] !== " ") {
    const space = text.lastIndexOf(" ", to - 1);
    if (space > 0 && to - space <= WORD_TRIM_MAX) to = space;
  }
  if (isLowSurrogate(text, to)) to -= 1;
  return `${text.slice(0, to).trimEnd()}${ELLIPSIS}`;
}

/**
 * The block's text when it fits in `CONTEXT_MAX`; otherwise a window
 * centred on the link, cut back to word boundaries near the edges (never
 * through a surrogate pair), with `…` marking each cut. A word-boundary
 * cut never moves into the link; but when the link run alone is longer
 * than the window, the window starts at the link and its end cut falls
 * inside the link.
 */
function contextAround(text: string, start: number, end: number): string {
  if (text.length <= CONTEXT_MAX) return text;

  const budget = CONTEXT_MAX - 2 * ELLIPSIS.length;
  const slack = Math.max(0, budget - (end - start));
  let from = Math.max(0, start - Math.floor(slack / 2));
  let to = Math.min(text.length, from + budget);
  from = Math.max(0, to - budget);

  if (from > 0 && text[from - 1] !== " ") {
    const space = text.indexOf(" ", from);
    if (space !== -1 && space < start && space - from <= WORD_TRIM_MAX) {
      from = space + 1;
    }
  }
  if (to < text.length && text[to] !== " ") {
    const space = text.lastIndexOf(" ", to - 1);
    if (space >= end && to - space <= WORD_TRIM_MAX) to = space;
  }
  if (from > 0 && isLowSurrogate(text, from)) from += 1;
  if (to < text.length && isLowSurrogate(text, to)) to -= 1;

  const head = from > 0 ? ELLIPSIS : "";
  const tail = to < text.length ? ELLIPSIS : "";
  return `${head}${text.slice(from, to).trim()}${tail}`;
}

function isLowSurrogate(text: string, index: number): boolean {
  const code = text.charCodeAt(index);
  return code >= 0xdc00 && code <= 0xdfff;
}

/**
 * FNV-1a (32-bit) over the rows as JSON: cheap, stable, and unambiguous
 * (null stays distinct from "", and no separator can collide with text).
 * At 32 bits two different row sets collide about once in 4 billion
 * changes; a collision only skips that one write, and the next change
 * writes the rows.
 */
export function linksHash(rows: readonly LinkRow[]): string {
  const canonical = JSON.stringify(
    rows.map((row) => [
      row.srcTocId,
      row.key,
      row.tocId,
      row.text,
      row.context,
    ]),
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
