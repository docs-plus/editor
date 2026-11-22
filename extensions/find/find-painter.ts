import type { EditorView } from "@tiptap/pm/view";

import type { FindHit } from "./find-hits";

/** Highlight names; the find bar's stylesheet colours them. */
export const FIND_HIGHLIGHT = "tinydocy-find";
export const FIND_CURRENT_HIGHLIGHT = "tinydocy-find-current";

/** How long one frame may spend building ranges before yielding. */
const FRAME_BUDGET_MS = 6;

/** Draws the hits and brings one into view. */
export interface FindPainter {
  /**
   * Shows `hits` with `current` emphasised. `dropped` are hits shown
   * before that are gone (their ranges are released).
   */
  paint(
    hits: readonly FindHit[],
    dropped: readonly FindHit[],
    current: FindHit | null,
  ): void;
  /** Scrolls `hit` into view inside the editor's scroll container. */
  reveal(hit: FindHit): void;
  destroy(): void;
}

/** True where the CSS Custom Highlight API exists (Chromium 105, Safari 17.2, Firefox 140). */
export function supportsHighlights(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight === "function"
  );
}

/** The parts of the Highlight API the painter uses (injectable for tests). */
export interface HighlightApi {
  registry: Pick<HighlightRegistry, "get" | "set" | "delete">;
  create(): Highlight;
}

/** The browser's Highlight API, or null where it is missing. */
export function nativeHighlightApi(): HighlightApi | null {
  return supportsHighlights()
    ? { registry: CSS.highlights, create: () => new Highlight() }
    : null;
}

/** The nearest ancestor that scrolls vertically, else the page. */
function scrollParent(node: HTMLElement): HTMLElement {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (
      (overflowY === "auto" || overflowY === "scroll") &&
      el.scrollHeight > el.clientHeight
    ) {
      return el;
    }
  }
  return (document.scrollingElement as HTMLElement) ?? document.documentElement;
}

/**
 * Paints hits with the CSS Custom Highlight API (details spec §1 rule 6,
 * amended for P2.11): the browser draws `Range`s over the text, so Find
 * adds no plugin, no decoration and no DOM node to the editor. Typing,
 * IME composition and remote updates are never redrawn because of it,
 * and it costs the editor chunk nothing.
 *
 * Ranges are live: unchanged text keeps them through edits elsewhere. A
 * range is built (time-sliced, current hit first) for each new hit, and
 * rebuilt for the hits in any top-level block whose DOM ProseMirror
 * redraws, which a `MutationObserver` reports (a collaborator's caret, a
 * mark change). Where the API is missing, nothing is painted; counting,
 * stepping and replacing still work.
 */
export class HighlightPainter implements FindPainter {
  private readonly ranges = new Map<FindHit, Range>();
  private readonly pending = new Set<FindHit>();
  private readonly dirty = new Set<Element>();
  private readonly registry: HighlightApi["registry"] | null = null;
  private readonly all: Highlight | null = null;
  private readonly current: Highlight | null = null;
  private readonly observer: MutationObserver | null = null;
  private hits: readonly FindHit[] = [];
  private currentHit: FindHit | null = null;
  private frame = 0;

  constructor(
    private readonly view: EditorView,
    api: HighlightApi | null = nativeHighlightApi(),
  ) {
    if (!api) return;
    this.registry = api.registry;
    this.all = api.create();
    this.current = api.create();
    this.current.priority = 1;
    this.registry.set(FIND_HIGHLIGHT, this.all);
    this.registry.set(FIND_CURRENT_HIGHLIGHT, this.current);
    this.observer = new MutationObserver(this.onMutations);
    this.observer.observe(view.dom, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  paint(
    hits: readonly FindHit[],
    dropped: readonly FindHit[],
    current: FindHit | null,
  ): void {
    for (const hit of dropped) this.release(hit);
    this.hits = hits;
    this.currentHit = current;
    if (!this.all) return;
    for (const hit of hits) if (!this.ranges.has(hit)) this.pending.add(hit);
    this.paintCurrent();
    this.schedule();
  }

  reveal(hit: FindHit): void {
    const range = this.rangeFor(hit);
    if (!range) return;
    const container = scrollParent(this.view.dom);
    const align = () => {
      const rect = range.getBoundingClientRect();
      const page = container === document.scrollingElement;
      const box = page
        ? { top: 0, bottom: window.innerHeight, height: window.innerHeight }
        : container.getBoundingClientRect();
      const style = getComputedStyle(container);
      const top = box.top + (Number.parseFloat(style.scrollPaddingTop) || 0);
      const bottom =
        box.bottom - (Number.parseFloat(style.scrollPaddingBottom) || 0);
      if (rect.top >= top && rect.bottom <= bottom) return;
      // A third of the way down, as browsers place a find result.
      container.scrollTop += rect.top - (top + (bottom - top) / 3);
    };
    align();
    // Off-screen blocks are laid out at an estimated height
    // (`content-visibility: auto`); align again once they have rendered.
    requestAnimationFrame(() => {
      if (this.ranges.get(hit) === range) align();
    });
  }

  destroy(): void {
    cancelAnimationFrame(this.frame);
    this.observer?.disconnect();
    // Only our own entries: a newer painter may have taken the names.
    if (this.registry?.get(FIND_HIGHLIGHT) === this.all) {
      this.registry?.delete(FIND_HIGHLIGHT);
    }
    if (this.registry?.get(FIND_CURRENT_HIGHLIGHT) === this.current) {
      this.registry?.delete(FIND_CURRENT_HIGHLIGHT);
    }
    this.ranges.clear();
    this.pending.clear();
    this.dirty.clear();
  }

  private release(hit: FindHit): void {
    const range = this.ranges.get(hit);
    if (range) {
      this.all?.delete(range);
      this.current?.delete(range);
      this.ranges.delete(hit);
    }
    this.pending.delete(hit);
  }

  private paintCurrent(): void {
    if (!this.current) return;
    this.current.clear();
    const range = this.currentHit && this.rangeFor(this.currentHit);
    if (range) this.current.add(range);
  }

  /** The hit's range, built now if it has none (null if the DOM can't map it). */
  private rangeFor(hit: FindHit): Range | null {
    const existing = this.ranges.get(hit);
    if (existing && !this.pending.has(hit)) return existing;
    return this.build(hit);
  }

  private build(hit: FindHit): Range | null {
    this.pending.delete(hit);
    const old = this.ranges.get(hit);
    if (old) {
      this.all?.delete(old);
      this.current?.delete(old);
      this.ranges.delete(hit);
    }
    try {
      const start = this.view.domAtPos(hit.from, 1);
      const end = this.view.domAtPos(hit.to, -1);
      const range = document.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      this.ranges.set(hit, range);
      this.all?.add(range);
      if (hit === this.currentHit) this.current?.add(range);
      return range;
    } catch {
      return null;
    }
  }

  private schedule(): void {
    if (this.frame || (this.pending.size === 0 && this.dirty.size === 0)) {
      return;
    }
    this.frame = requestAnimationFrame(this.flush);
  }

  private readonly flush = () => {
    this.frame = 0;
    if (this.view.isDestroyed) return;
    this.markDirtyHits();
    const deadline = performance.now() + FRAME_BUDGET_MS;
    for (const hit of this.pending) {
      this.build(hit);
      if (performance.now() > deadline) break;
    }
    this.schedule();
  };

  /** Queues the hits inside each redrawn top-level block. */
  private markDirtyHits(): void {
    if (this.dirty.size === 0) return;
    const { doc } = this.view.state;
    for (const el of this.dirty) {
      if (el.parentNode !== this.view.dom) continue;
      let from: number;
      let to: number;
      try {
        const $pos = doc.resolve(this.view.posAtDOM(el, 0));
        if ($pos.depth < 1) continue;
        from = $pos.before(1);
        to = $pos.after(1);
      } catch {
        continue;
      }
      for (let i = this.firstHitAtOrAfter(from); i < this.hits.length; i++) {
        const hit = this.hits[i];
        if (hit.from >= to) break;
        this.pending.add(hit);
      }
    }
    this.dirty.clear();
  }

  private firstHitAtOrAfter(pos: number): number {
    let low = 0;
    let high = this.hits.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (this.hits[mid].from < pos) low = mid + 1;
      else high = mid;
    }
    return low;
  }

  private readonly onMutations = (records: MutationRecord[]) => {
    const root = this.view.dom;
    for (const record of records) {
      if (record.target === root) {
        for (const node of record.addedNodes) {
          if (node instanceof Element) this.dirty.add(node);
        }
        continue;
      }
      let node: Node | null = record.target;
      while (node && node.parentNode !== root) node = node.parentNode;
      if (node instanceof Element) this.dirty.add(node);
    }
    this.schedule();
  };
}
