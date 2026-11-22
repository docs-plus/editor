/**
 * The links-only pass (search-linking design §5). Walks an open document's
 * Yjs fragment and emits one row per document link (§4.1, `kind: "doc"`)
 * for the derived `links` table behind Linked from. It reads only the
 * `hyperlink` mark attributes and the text of the blocks that hold a
 * document link (as `context`); it builds no search index. `here#`,
 * external and malformed links are skipped.
 *
 * `linksHash` lets the caller skip a pass whose rows haven't changed.
 */
import * as Y from "yjs";

import { parseDocLink } from "@/lib/links/doc-link";

export interface LinkRow {
  /** `data-toc-id` of the section's heading; null when it has none. */
  readonly srcTocId: string | null;
  readonly key: string;
  readonly tocId: string | null;
  readonly text: string;
  /** Up to `CONTEXT_MAX` characters of the block around the link. */
  readonly context: string;
}

/** y-tiptap stores a mark under its name when it excludes itself. */
const LINK_MARK = "hyperlink";
const TOC_ID_ATTR = "data-toc-id";
const CONTEXT_MAX = 160;
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

export function extractLinks(fragment: Y.XmlFragment): LinkRow[] {
  const rows: LinkRow[] = [];
  let srcTocId: string | null = null;
  for (const child of fragment.toArray()) {
    if (!(child instanceof Y.XmlElement)) continue;
    if (child.nodeName === "heading") srcTocId = tocIdOf(child);
    collectBlock(child, srcTocId, rows);
  }
  return rows;
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
      text: text.slice(run.start, run.end),
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
 * The block's text when it fits in `CONTEXT_MAX`; otherwise a window
 * centred on the link, cut back to word boundaries near the edges (never
 * into the link or a surrogate pair), with `…` marking each cut.
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
