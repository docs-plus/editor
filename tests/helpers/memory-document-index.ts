import type {
  DocumentEntry,
  DocumentIndex,
  DocumentIndexListener,
  DocumentIndexSnapshot,
  RestorableEntry,
  RestoreResult,
  TrashResult,
} from "@/lib/platform/document-index";

export interface MemoryDocumentIndexOptions {
  /** Listed at the start. */
  items?: readonly DocumentEntry[];
  /** Start not ready; `load()` makes it ready. */
  deferLoad?: boolean;
  /** Ids `trash` refuses. */
  failTrash?: readonly string[];
}

/**
 * `DocumentIndex` in memory, for the contract suite and for hosts that
 * have no store yet. The Trash is a map; restore puts an entry back at the
 * position it was trashed from. Ids come from `crypto.randomUUID()`.
 */
export class MemoryDocumentIndex implements DocumentIndex {
  private readonly listeners = new Set<DocumentIndexListener>();
  private readonly trashBin = new Map<string, DocumentEntry>();
  private readonly failTrash: ReadonlySet<string>;
  private items: DocumentEntry[];
  private current: DocumentIndexSnapshot;
  private destroyed = false;

  constructor(options: MemoryDocumentIndexOptions = {}) {
    this.items = [...(options.items ?? [])];
    this.failTrash = new Set(options.failTrash);
    this.current = options.deferLoad
      ? { rev: 0, ready: false, items: [] }
      : { rev: 1, ready: true, items: [...this.items] };
  }

  /** Makes a deferred index ready, or reloads it: emits `load`. */
  load(): void {
    this.publish("load");
  }

  /** Forgets trashed documents, so restoring them answers `gone`. */
  purgeTrash(): void {
    this.trashBin.clear();
  }

  snapshot(): DocumentIndexSnapshot {
    return this.current;
  }

  subscribe(listener: DocumentIndexListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  create(init?: { title?: string }): DocumentEntry | null {
    if (!this.writable()) return null;
    const entry: DocumentEntry = {
      id: crypto.randomUUID(),
      title: init?.title ?? "Untitled",
      createdAt: Date.now(),
    };
    this.items.push(entry);
    this.publish("change");
    return entry;
  }

  rename(id: string, title: string): void {
    if (!this.writable()) return;
    const idx = this.items.findIndex((item) => item.id === id);
    if (idx < 0) return;
    this.items[idx] = { ...this.items[idx], title };
    this.publish("change");
  }

  move(id: string, toIndex: number): void {
    if (!this.writable()) return;
    const from = this.items.findIndex((item) => item.id === id);
    const to = Math.min(Math.max(toIndex, 0), this.items.length - 1);
    if (from < 0 || from === to) return;
    const [moved] = this.items.splice(from, 1);
    this.items.splice(to, 0, moved);
    this.publish("change");
  }

  async trash(ids: readonly string[]): Promise<TrashResult> {
    await Promise.resolve();
    if (!this.writable()) return { trashed: [], failed: [...ids] };
    const trashed: RestorableEntry[] = [];
    const failed: string[] = [];
    for (const id of ids) {
      const index = this.items.findIndex((item) => item.id === id);
      if (index < 0 || this.failTrash.has(id)) {
        failed.push(id);
        continue;
      }
      trashed.push({ id, title: this.items[index].title, index });
    }
    if (trashed.length === 0) return { trashed, failed };
    const gone = new Set(trashed.map((entry) => entry.id));
    for (const item of this.items) {
      if (gone.has(item.id)) this.trashBin.set(item.id, item);
    }
    this.items = this.items.filter((item) => !gone.has(item.id));
    this.publish("change");
    return { trashed, failed };
  }

  async restore(
    entries: readonly RestorableEntry[],
  ): Promise<Record<string, RestoreResult> | null> {
    await Promise.resolve();
    if (!this.writable() || entries.length === 0) return null;
    const results: Record<string, RestoreResult> = {};
    const ordered = [...entries].sort(
      (a, b) => (a.index ?? Infinity) - (b.index ?? Infinity),
    );
    let changed = false;
    for (const entry of ordered) {
      const trashed = this.trashBin.get(entry.id);
      if (!trashed) {
        const listed = this.items.some((item) => item.id === entry.id);
        results[entry.id] = listed ? "not_closed" : "gone";
        continue;
      }
      this.trashBin.delete(entry.id);
      const at = Math.min(entry.index ?? this.items.length, this.items.length);
      this.items.splice(at, 0, trashed);
      results[entry.id] = "restored";
      changed = true;
    }
    if (changed) this.publish("change");
    return results;
  }

  destroy(): void {
    this.destroyed = true;
    this.listeners.clear();
  }

  private writable(): boolean {
    return this.current.ready && !this.destroyed;
  }

  private publish(type: "load" | "change"): void {
    this.current = {
      rev: this.current.rev + 1,
      ready: true,
      items: [...this.items],
    };
    const snapshot = this.current;
    for (const listener of [...this.listeners]) listener(type, snapshot);
  }
}
