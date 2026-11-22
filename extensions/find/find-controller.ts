import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import {
  adoptHits,
  type FindHit,
  MAX_FIND_HITS,
  paintableHits,
  scanHits,
  updateHits,
} from "./find-hits";
import {
  type FindPainter,
  HighlightPainter,
  SelectionPainter,
} from "./find-painter";
import { buildFindPattern, type FindOptions } from "./find-pattern";
import { supportsHighlights } from "./highlight-support";

/** What the find bar shows. A new object only when something changed. */
export interface FindSnapshot extends FindOptions {
  query: string;
  /** Hits found, at most `MAX_FIND_HITS`. */
  total: number;
  /** More hits exist than `total`. */
  capped: boolean;
  /** Index of the current hit, or -1. */
  current: number;
}

/** The longest replacement text (the field's `maxLength`). */
export const MAX_REPLACEMENT_LENGTH = 1_000;

/**
 * The most bytes one Replace all may add to the document. Past it the bar
 * says "Too large to replace". It keeps one click's growth far below the
 * server's limit (`MAX_DOC_SIZE_BYTES`, 2 MiB in production), past which
 * the document turns read-only with the change unsaved; a document already
 * near that limit is refused by the server as for any other edit.
 */
export const MAX_REPLACE_ALL_GROWTH = 256 * 1024;

/** What Replace all did. */
export type ReplaceAllResult = { replaced: number } | { refused: "too-large" };

/**
 * Bytes that replacing every hit with `text` adds (negative: removes),
 * erring high: `text` counts in UTF-8, as Yjs stores it, and each replaced
 * character as one byte.
 */
export function projectedGrowth(
  hits: readonly FindHit[],
  text: string,
): number {
  const bytes = new TextEncoder().encode(text).length;
  let growth = 0;
  for (const hit of hits) growth += bytes - (hit.to - hit.from);
  return growth;
}

/**
 * Replaces `from`-`to` with `text`, keeping the replaced text's own marks
 * (never the stored marks of a caret toggle) and the selection, and never
 * widening a deletion to the enclosing block (`insertText("")` would).
 */
function replaceRange(
  tr: Transaction,
  from: number,
  to: number,
  text: string,
): void {
  if (!text) {
    tr.delete(from, to);
    return;
  }
  const marks = tr.doc.nodeAt(from)?.marks ?? [];
  tr.replaceWith(from, to, tr.doc.type.schema.text(text, marks));
}

/** Quiet time before a capped hit list is counted again after edits. */
const RESCAN_DELAY_MS = 400;

const EMPTY: FindSnapshot = {
  query: "",
  caseSensitive: false,
  wholeWord: false,
  total: 0,
  capped: false,
  current: -1,
};

interface TransactionEvent {
  transaction: Transaction;
  appendedTransactions?: readonly Transaction[];
}

/** Index of the first hit starting at or after `pos` (`hits.length` if none). */
function firstAtOrAfter(hits: readonly FindHit[], pos: number): number {
  let low = 0;
  let high = hits.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (hits[mid].from < pos) low = mid + 1;
    else high = mid;
  }
  return low;
}

/**
 * Find and replace over one editor (details spec E1, P2.11), with no
 * plugin: it follows the editor's `transaction` event, so it can live in a
 * lazy chunk without `registerPlugin` (which re-creates every plugin view).
 *
 * - A new query scans the textblocks once; block texts are cached per
 *   immutable node.
 * - A document change while Find is open, local or a collaborator's,
 *   rescans only the textblocks it touched (`updateHits`) and maps the
 *   rest, so typing with Find open on 1,000 headings costs a block, not a
 *   document.
 * - Stepping never moves the selection or focus (the bubble stays shut and
 *   collaborators see no jump); `selectCurrent` does, when the bar closes.
 *   Without the Highlight API, `SelectionPainter` selects each hit it moves
 *   to instead (never focus), so the current hit is still visible.
 */
export class FindController {
  private hits: FindHit[] = [];
  private pattern: RegExp | null = null;
  private currentHit: FindHit | null = null;
  /** What the painter shows: `hits`, or a window of a crowded block's. */
  private painted: readonly FindHit[] = [];
  private snapshot: FindSnapshot = EMPTY;
  private rescanTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly painter: FindPainter;

  constructor(
    private readonly editor: Editor,
    painter?: FindPainter,
  ) {
    this.painter =
      painter ??
      (supportsHighlights()
        ? new HighlightPainter(editor.view)
        : new SelectionPainter(editor));
    editor.on("transaction", this.onTransaction);
  }

  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = () => this.snapshot;

  /** Searches for `query` with `options`, from the selection onward. */
  search(query: string, options: FindOptions): void {
    const dropped = this.hits;
    this.pattern = buildFindPattern(query, options);
    const { doc, selection } = this.editor.state;
    this.hits = this.pattern ? scanHits(doc, this.pattern) : [];
    this.currentHit =
      this.hits[firstAtOrAfter(this.hits, selection.from)] ??
      this.hits[0] ??
      null;
    this.paint(dropped);
    if (this.currentHit) this.painter.reveal(this.currentHit);
    this.publish(query, options);
  }

  /** Moves to the next hit (`-1`: the previous one), wrapping around. */
  step(direction: 1 | -1): void {
    const count = this.hits.length;
    if (count === 0) return;
    const index = this.currentIndex();
    const next = index < 0 ? 0 : (index + direction + count) % count;
    this.currentHit = this.hits[next];
    this.paint([]);
    this.painter.reveal(this.currentHit);
    this.publish();
  }

  /**
   * Replaces the current hit and moves to the next one after the
   * replacement (never into it, so replacing "a" with "aa" ends). False
   * when nothing was replaced (no hit, or the document is read-only).
   */
  replace(text: string): boolean {
    const hit = this.currentHit;
    if (
      !hit ||
      !this.editor.isEditable ||
      text.length > MAX_REPLACEMENT_LENGTH
    ) {
      return false;
    }
    const { from, to } = hit;
    const before = this.editor.state.doc;
    const tr = this.editor.state.tr;
    replaceRange(tr, from, to, text);
    this.editor.view.dispatch(tr);
    if (this.editor.state.doc === before) return false;
    const after = from + text.length;
    this.currentHit =
      this.hits[firstAtOrAfter(this.hits, after)] ?? this.hits[0] ?? null;
    this.paint([]);
    if (this.currentHit) this.painter.reveal(this.currentHit);
    this.publish();
    return true;
  }

  /**
   * Replaces every hit, past the 10,000 shown, in one transaction (one undo
   * step), unless that would add more than `MAX_REPLACE_ALL_GROWTH` bytes
   * or `text` is longer than `MAX_REPLACEMENT_LENGTH`.
   */
  replaceAll(text: string): ReplaceAllResult {
    if (text.length > MAX_REPLACEMENT_LENGTH) return { refused: "too-large" };
    if (!this.pattern || !this.editor.isEditable) return { replaced: 0 };
    const { state } = this.editor;
    const all = scanHits(
      state.doc,
      this.pattern,
      0,
      state.doc.content.size,
      [],
      Number.POSITIVE_INFINITY,
    );
    if (all.length === 0) return { replaced: 0 };
    if (projectedGrowth(all, text) > MAX_REPLACE_ALL_GROWTH) {
      return { refused: "too-large" };
    }
    const tr = state.tr;
    // Last to first, so earlier positions need no mapping.
    for (let i = all.length - 1; i >= 0; i--) {
      replaceRange(tr, all[i].from, all[i].to, text);
    }
    this.editor.view.dispatch(tr);
    return { replaced: this.editor.state.doc === state.doc ? 0 : all.length };
  }

  /**
   * Selects the current hit in the editor and focuses it (the bar is
   * closing). False when there is no hit; the selection is then left alone.
   */
  selectCurrent(): boolean {
    const hit = this.currentHit;
    if (!hit) return false;
    this.editor
      .chain()
      .setTextSelection({ from: hit.from, to: hit.to })
      .scrollIntoView()
      .run();
    return true;
  }

  destroy(): void {
    clearTimeout(this.rescanTimer);
    this.editor.off("transaction", this.onTransaction);
    this.painter.destroy();
    this.listeners.clear();
    this.hits = [];
    this.painted = [];
    this.currentHit = null;
  }

  /**
   * Hands the painter the hits to show (`paintableHits`). `dropped` are
   * gone from the document; hits that left a crowded block's window are
   * released with them.
   */
  private paint(dropped: FindHit[]): void {
    const previous = this.painted;
    const next = paintableHits(
      this.editor.state.doc,
      this.hits,
      this.currentHit,
    );
    if (next !== this.hits || previous !== this.hits) {
      const shown = new Set(next);
      // `previous` may be `dropped` itself (a new search drops every hit).
      const left = previous.filter((hit) => !shown.has(hit));
      dropped.push(...left);
    }
    this.painted = next;
    this.painter.paint(next, dropped, this.currentHit);
  }

  private currentIndex(): number {
    const hit = this.currentHit;
    if (!hit) return -1;
    const index = firstAtOrAfter(this.hits, hit.from);
    return this.hits[index] === hit ? index : -1;
  }

  private readonly onTransaction = ({
    transaction,
    appendedTransactions = [],
  }: TransactionEvent) => {
    const pattern = this.pattern;
    if (!pattern) return;
    const dropped: FindHit[] = [];
    let changed = false;
    for (const tr of [transaction, ...appendedTransactions]) {
      if (!tr.docChanged) continue;
      changed = true;
      const anchor = this.currentHit
        ? tr.mapping.map(this.currentHit.from, -1)
        : 0;
      const update = updateHits(this.hits, tr, pattern);
      this.hits = update.hits;
      dropped.push(...update.dropped);
      if (this.currentHit && this.currentIndex() < 0) {
        // Its text changed: the next hit takes its place, without a scroll.
        this.currentHit =
          this.hits[firstAtOrAfter(this.hits, anchor)] ?? this.hits[0] ?? null;
      } else if (!this.currentHit) {
        this.currentHit = this.hits[0] ?? null;
      }
    }
    if (!changed) return;
    this.paint(dropped);
    // A capped list may now miss hits past the cap: count again when idle.
    if (this.snapshot.capped) this.scheduleRescan();
    this.publish();
  };

  private scheduleRescan(): void {
    clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => {
      if (!this.pattern || this.editor.isDestroyed) return;
      const previous = new Map(this.hits.map((hit) => [hit.from, hit]));
      const anchor = this.currentHit?.from ?? 0;
      this.hits = scanHits(this.editor.state.doc, this.pattern);
      // Unchanged hits keep their objects, so their ranges are not rebuilt.
      adoptHits(this.hits, previous);
      const dropped = [...previous.values()];
      this.currentHit =
        this.hits[firstAtOrAfter(this.hits, anchor)] ?? this.hits[0] ?? null;
      this.paint(dropped);
      this.publish();
    }, RESCAN_DELAY_MS);
  }

  private publish(
    query = this.snapshot.query,
    options: FindOptions = this.snapshot,
  ): void {
    const next: FindSnapshot = {
      query,
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      total: this.hits.length,
      capped: this.hits.length >= MAX_FIND_HITS,
      current: this.currentIndex(),
    };
    const prev = this.snapshot;
    if (
      prev.query === next.query &&
      prev.caseSensitive === next.caseSensitive &&
      prev.wholeWord === next.wholeWord &&
      prev.total === next.total &&
      prev.capped === next.capped &&
      prev.current === next.current
    ) {
      return;
    }
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
}
