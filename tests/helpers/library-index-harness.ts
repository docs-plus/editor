/**
 * P2.7b's `LibraryIndex` contract on the SQLite library (P2.6e): one
 * factory for both runs, so they share every line but the transport.
 * - `bun test` (`tests/unit/platform/library-index-rpc.test.ts`): the
 *   engine on `bun:sqlite`, in-process through the worker's `dispatch`.
 * - The Electron soak (`desktop/storage-harness`, `--mode=contract`): the
 *   real worker on `node:sqlite`, through `StorageClient`.
 *
 * The contract's factory, `load` and `purge` are synchronous, so the
 * library is seeded on this thread with the engine (fixture ids, and a
 * clock pinned to each fixture's `createdAt`), and its first load is read
 * there too; the transport may start later (the worker). After seeding the
 * clock only grows, by at least 1 ms a call: two Trash operations in the
 * same millisecond would otherwise tie, and the Trash list would order
 * them by id.
 *
 * No Bun or DOM API: the Electron harness bundles this file.
 */
import * as Y from "yjs";

import type { Library } from "@/desktop/storage/engine/library";
import {
  dispatch,
  type StorageOp,
  type StorageOps,
  type StorageRequest,
} from "@/desktop/storage/protocol";
import {
  type LibraryLoad,
  RpcLibraryIndex,
} from "@/lib/platform/desktop/library-index-rpc";
import type { LibraryIndex } from "@/lib/platform/document-index";
import type {
  LibraryContractFactory,
  LibraryContractOptions,
} from "@/tests/unit/platform/document-index-contract";

export type StorageCall = <K extends StorageOp>(
  op: K,
  args: StorageOps[K]["args"],
) => Promise<StorageOps[K]["result"]>;

/** A connection to one library: a worker, or a `Library` in-process. */
export interface LibraryTransport {
  call: StorageCall;
  /** The worker's `index_changed` feed. */
  onIndexChanged(listener: (rev: number, changes: unknown[]) => void): void;
  /** Shuts the library down (the quit flush). */
  close(): Promise<void>;
}

/** A clock the seed pins; afterwards it only grows. */
export interface SeedClock {
  pinned: number | null;
  now(): number;
}

export function createSeedClock(): SeedClock {
  let last = 0;
  return {
    pinned: null,
    now() {
      if (this.pinned !== null) return this.pinned;
      last = Math.max(Date.now(), last + 1);
      return last;
    },
  };
}

export interface LibraryBackend {
  /** A new, empty library folder; `remove` deletes it. */
  tempDir(): { dir: string; remove(): void };
  /** Opens the library on this thread, synchronously, with `now`. */
  open(dir: string, now: () => number): Library;
  /**
   * A transport to the library in `dir`. `seeded` is the library `open`
   * returned, still open: an in-process backend keeps it, a worker backend
   * shuts it down and starts the worker (lazily is fine).
   */
  attach(dir: string, seeded: Library | null): LibraryTransport;
  /** Called with each case's cleanup; the runner runs them after the case. */
  track(cleanup: () => Promise<void>): void;
}

/** The first load, read on this thread. */
export function readLoad(library: Library): LibraryLoad {
  return {
    sidebar: library.sidebar(),
    trash: library.trashList(),
    placeViews: library.placeViews(),
  };
}

/** Writes the contract's fixtures with their ids and creation times. */
export function seedLibrary(
  library: Library,
  clock: SeedClock,
  options: LibraryContractOptions,
): void {
  const folders = [...(options.folders ?? [])];
  const made = new Set<string>();
  // Parents first, whatever the fixture order.
  while (folders.length > 0) {
    const at = folders.findIndex(
      (folder) => folder.parentId === null || made.has(folder.parentId),
    );
    if (at < 0) throw new Error("folder fixtures have a missing parent");
    const [folder] = folders.splice(at, 1);
    clock.pinned = folder.createdAt;
    library.createFolder({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
    });
    made.add(folder.id);
  }
  for (const tag of options.tags ?? [])
    library.createTag(tag.name, tag.color, tag.id);
  for (const item of options.items ?? []) {
    clock.pinned = item.createdAt;
    library.createDoc({
      id: item.id,
      title: item.title,
      folderId: item.folderId ?? null,
      sortKey: item.sortKey ?? "",
    });
    if (item.pinKey !== undefined) library.pinDoc(item.id, item.pinKey);
    if (item.tagIds?.length) library.setDocTags(item.id, [...item.tagIds]);
    if (item.openedAt !== undefined) {
      clock.pinned = item.openedAt;
      library.markOpened(item.id);
    }
  }
  clock.pinned = null;
  library.takeIndexChanges();
}

/**
 * What the composition root does for `rename` (G4), in storage terms: a
 * headless session claims the document, appends one `local` update with
 * the new title, and releases it.
 */
export function titleWriter(call: StorageCall) {
  return async (id: string, title: string) => {
    const owner = `rename-${id}`;
    await call("load", { docId: id, owner });
    const doc = new Y.Doc();
    doc.getText("title").insert(0, title);
    await call("append", {
      docId: id,
      owner,
      record: { origin: "local", update: Y.encodeStateAsUpdate(doc), title },
    });
    await call("close", { docId: id, owner });
  };
}

/**
 * A `RpcLibraryIndex` on `transport`. Writes storage refuses land in
 * `errors`; the contract's `settle` fails on any, so a refused write can't
 * pass as a reload.
 */
function indexOn(
  transport: LibraryTransport,
  errors: string[],
  initial?: LibraryLoad,
): RpcLibraryIndex {
  const index = new RpcLibraryIndex({
    call: transport.call,
    renameTitle: titleWriter(transport.call),
    initial,
    onError: (error, op) =>
      errors.push(
        `${op}: ${(error as { code?: string }).code ?? ""} ${String((error as Error)?.message ?? error)}`,
      ),
  });
  transport.onIndexChanged((rev, changes) => index.indexChanged(rev, changes));
  return index;
}

export function createLibraryContractFactory(
  backend: LibraryBackend,
): LibraryContractFactory {
  return (options) => {
    const temp = backend.tempDir();
    const clock = createSeedClock();
    const now = () => clock.now();
    const seeded = backend.open(temp.dir, now);
    seedLibrary(seeded, clock, options);
    const first = readLoad(seeded);
    const errors: string[] = [];
    const transports: LibraryTransport[] = [];
    const attach = (library: Library | null) => {
      const transport = backend.attach(temp.dir, library);
      transports.push(transport);
      return transport;
    };
    const transport = attach(seeded);
    const index = indexOn(
      transport,
      errors,
      options.deferLoad ? undefined : first,
    );
    let latest: { index: RpcLibraryIndex; transport: LibraryTransport } = {
      index,
      transport,
    };
    backend.track(async () => {
      await Promise.allSettled([latest.index.settle()]);
      for (const open of transports) await open.close().catch(() => {});
      temp.remove();
    });
    return {
      index,
      load: () => index.hydrate(first),
      purge: () => index.purgeTrash(),
      async settle(target: LibraryIndex) {
        await (target as RpcLibraryIndex).settle();
        if (errors.length > 0)
          throw new Error(`storage refused writes: ${errors.join("; ")}`);
      },
      async reopen() {
        await latest.index.settle();
        latest.index.destroy();
        await latest.transport.close();
        const next = attach(backend.open(temp.dir, now));
        const again = indexOn(next, errors);
        await again.load();
        latest = { index: again, transport: next };
        return again;
      },
    };
  };
}

/** Copies bytes on the way in and out, as IPC would. */
function copyBytes<T>(value: T): T {
  if (value instanceof Uint8Array) return value.slice() as T;
  if (Array.isArray(value)) return value.map(copyBytes) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, copyBytes(v)]),
    ) as T;
  return value;
}

let nextRequest = 1;

/**
 * An in-process transport over the worker's own `dispatch`. Like the
 * worker, it announces `index_changed` after each reply (a timer later, so
 * the reply's rev is known first).
 */
export function inProcessTransport(library: Library): LibraryTransport {
  const listeners: ((rev: number, changes: unknown[]) => void)[] = [];
  let closed = false;
  const call = (async (op: StorageOp, args: unknown) => {
    await Promise.resolve();
    const result = dispatch(library, {
      id: nextRequest++,
      op,
      args: copyBytes(args),
    } as StorageRequest);
    const changed = closed ? null : library.takeIndexChanges();
    if (changed)
      setTimeout(() => {
        for (const listener of listeners)
          listener(changed.rev, changed.changes);
      }, 0);
    if (!result.ok) throw result.error;
    return copyBytes(result.value);
  }) as StorageCall;
  return {
    call,
    onIndexChanged: (listener) => listeners.push(listener),
    async close() {
      if (closed) return;
      closed = true;
      library.shutdown();
    },
  };
}
