import type { Editor } from "@tiptap/core";
import type { Transaction } from "@tiptap/pm/state";

import { type FindHit, MAX_FIND_HITS, scanHits, updateHits } from "./find-hits";
import { type FindPainter, HighlightPainter } from "./find-painter";
import { buildFindPattern, type FindOptions } from "./find-pattern";

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
 */
export class FindController {
  private hits: FindHit[] = [];
  private pattern: RegExp | null = null;
  private currentHit: FindHit | null = null;
  private snapshot: FindSnapshot = EMPTY;
  private rescanTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<() => void>();
  private readonly painter: FindPainter;

  constructor(
    private readonly editor: Editor,
    painter?: FindPainter,
  ) {
    this.painter = painter ?? new HighlightPainter(editor.view);
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
    this.painter.paint(this.hits, dropped, this.currentHit);
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
    this.painter.paint(this.hits, [], this.currentHit);
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
    if (!hit || !this.editor.isEditable) return false;
    const { from, to } = hit;
    const before = this.editor.state.doc;
    this.editor.view.dispatch(this.editor.state.tr.insertText(text, from, to));
    if (this.editor.state.doc === before) return false;
    const after = from + text.length;
    this.currentHit =
      this.hits[firstAtOrAfter(this.hits, after)] ?? this.hits[0] ?? null;
    this.painter.paint(this.hits, [], this.currentHit);
    if (this.currentHit) this.painter.reveal(this.currentHit);
    this.publish();
    return true;
  }

  /**
   * Replaces every hit, uncapped, in one transaction (one undo step).
   * Returns how many were replaced.
   */
  replaceAll(text: string): number {
    if (!this.pattern || !this.editor.isEditable) return 0;
    const { state } = this.editor;
    const all = scanHits(
      state.doc,
      this.pattern,
      0,
      state.doc.content.size,
      [],
      Number.POSITIVE_INFINITY,
    );
    if (all.length === 0) return 0;
    const tr = state.tr;
    for (let i = all.length - 1; i >= 0; i--) {
      tr.insertText(text, all[i].from, all[i].to);
    }
    this.editor.view.dispatch(tr);
    return this.editor.state.doc === state.doc ? 0 : all.length;
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
    this.currentHit = null;
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
    this.painter.paint(this.hits, dropped, this.currentHit);
    // A capped list may now miss hits past the cap: count again when idle.
    if (this.snapshot.capped) this.scheduleRescan();
    this.publish();
  };

  private scheduleRescan(): void {
    clearTimeout(this.rescanTimer);
    this.rescanTimer = setTimeout(() => {
      if (!this.pattern || this.editor.isDestroyed) return;
      const dropped = this.hits;
      const anchor = this.currentHit?.from ?? 0;
      this.hits = scanHits(this.editor.state.doc, this.pattern);
      this.currentHit =
        this.hits[firstAtOrAfter(this.hits, anchor)] ?? this.hits[0] ?? null;
      this.painter.paint(this.hits, dropped, this.currentHit);
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
