/**
 * `MemoryDocStore`: a `DocStore` in memory, for tests and the desktop dev
 * bridge (P2.4). It follows the desktop rules (architecture §5.2): one client
 * holds a document at a time (`already_open`), and compaction replaces the
 * snapshot and deletes every row with `seq ≤ upToSeq`.
 *
 * A `MemoryDocLibrary` is the shared data, like the SQLite file; each
 * `MemoryDocStore` is one client of it, like one window.
 */
import {
  type AppendRecord,
  type CompactResult,
  type DocStore,
  DocStoreError,
  type DocStoreErrorCode,
  type LoadedDoc,
  type UpdateOrigin,
} from "@/lib/platform/doc-store";

type StoredRow = { seq: number; origin: UpdateOrigin; data: Uint8Array };

type StoredDoc = {
  schema: number;
  snapshot: Uint8Array | null;
  /** The seq the snapshot covers. */
  snapshotSeq: number;
  rows: StoredRow[];
  title: string | null;
  snippet: string | null;
};

export type MemoryDocLibraryOptions = {
  /** `schema` of a document loaded before anything created it. Default 0, like the engine's `docs.schema`. */
  newDocSchema?: number;
};

export class MemoryDocLibrary {
  private readonly docs = new Map<string, StoredDoc>();
  private readonly holders = new Map<string, MemoryDocStore>();
  private lastSeq = 0;
  private readonly newDocSchema: number;

  constructor(options: MemoryDocLibraryOptions = {}) {
    this.newDocSchema = options.newDocSchema ?? 0;
  }

  /** Creates the document, as `DocumentIndex.create` would. */
  createDoc(docId: string, schema: number = this.newDocSchema): void {
    if (this.docs.has(docId)) return;
    this.docs.set(docId, {
      schema,
      snapshot: null,
      snapshotSeq: 0,
      rows: [],
      title: null,
      snippet: null,
    });
  }

  /** Update rows not yet compacted. */
  rowCount(docId: string): number {
    return this.docs.get(docId)?.rows.length ?? 0;
  }

  /** The last title appended, for tests. */
  titleOf(docId: string): string | null {
    return this.docs.get(docId)?.title ?? null;
  }

  /** @internal */
  claim(docId: string, client: MemoryDocStore): StoredDoc {
    const holder = this.holders.get(docId);
    if (holder && holder !== client) throw new DocStoreError("already_open");
    this.createDoc(docId);
    this.holders.set(docId, client);
    return this.docs.get(docId) as StoredDoc;
  }

  /** @internal */
  held(docId: string, client: MemoryDocStore): StoredDoc {
    const doc = this.docs.get(docId);
    if (!doc || this.holders.get(docId) !== client) {
      throw new DocStoreError("forbidden");
    }
    return doc;
  }

  /** @internal */
  release(docId: string, client: MemoryDocStore): void {
    if (this.holders.get(docId) === client) this.holders.delete(docId);
  }

  /** @internal */
  nextSeq(): number {
    return ++this.lastSeq;
  }
}

export type MemoryDocStoreOptions = {
  /** Shared with other clients; a private one by default. */
  library?: MemoryDocLibrary;
  /** Delays every `load`, to test loading states. */
  loadDelayMs?: number;
  /** Delays every `append` and `compact`, to test writes in flight. */
  writeDelayMs?: number;
};

type Method = "load" | "append" | "compact";

const delay = (ms: number) =>
  ms > 0 ? new Promise<void>((resolve) => setTimeout(resolve, ms)) : null;

export class MemoryDocStore implements DocStore {
  private readonly library: MemoryDocLibrary;
  private readonly loadDelayMs: number;
  private readonly writeDelayMs: number;
  private readonly failures: { method: Method; code: DocStoreErrorCode }[] = [];
  private readonly writes = new Set<Promise<unknown>>();

  constructor(options: MemoryDocStoreOptions = {}) {
    this.library = options.library ?? new MemoryDocLibrary();
    this.loadDelayMs = options.loadDelayMs ?? 0;
    this.writeDelayMs = options.writeDelayMs ?? 0;
  }

  /** The next call of `method` rejects with `code` and changes nothing. Queues. */
  failNext(method: Method, code: DocStoreErrorCode): void {
    this.failures.push({ method, code });
  }

  async load(docId: string): Promise<LoadedDoc> {
    await delay(this.loadDelayMs);
    this.throwIfFailing("load");
    const doc = this.library.claim(docId, this);
    return {
      snapshot: doc.snapshot ? doc.snapshot.slice() : null,
      updates: doc.rows.map((row) => row.data.slice()),
      maxSeq: doc.rows.at(-1)?.seq ?? doc.snapshotSeq,
      schema: doc.schema,
    };
  }

  append(docId: string, record: AppendRecord): Promise<number> {
    return this.write(async () => {
      this.throwIfFailing("append");
      const doc = this.library.held(docId, this);
      const seq = this.library.nextSeq();
      doc.rows.push({
        seq,
        origin: record.origin,
        data: record.update.slice(),
      });
      if (record.title !== undefined) doc.title = record.title;
      if (record.snippet !== undefined) doc.snippet = record.snippet;
      if (record.schemaTo !== undefined) doc.schema = record.schemaTo;
      return seq;
    });
  }

  compact(
    docId: string,
    state: Uint8Array,
    upToSeq: number,
  ): Promise<CompactResult> {
    return this.write(async () => {
      this.throwIfFailing("compact");
      const doc = this.library.held(docId, this);
      doc.snapshot = state.slice();
      doc.snapshotSeq = Math.max(doc.snapshotSeq, upToSeq);
      doc.rows = doc.rows.filter((row) => row.seq > upToSeq);
      return { foreign: null };
    });
  }

  async close(docId: string): Promise<void> {
    this.library.release(docId, this);
  }

  async flush(): Promise<void> {
    await Promise.allSettled([...this.writes]);
  }

  /** Runs `body` after the write delay and tracks it for `flush`. */
  private write<T>(body: () => Promise<T>): Promise<T> {
    const pending = (async () => {
      await delay(this.writeDelayMs);
      return body();
    })();
    this.writes.add(pending);
    const untrack = () => this.writes.delete(pending);
    pending.then(untrack, untrack);
    return pending;
  }

  private throwIfFailing(method: Method): void {
    const index = this.failures.findIndex((f) => f.method === method);
    if (index === -1) return;
    const [failure] = this.failures.splice(index, 1);
    throw new DocStoreError(failure.code);
  }
}
