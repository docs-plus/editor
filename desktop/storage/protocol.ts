/**
 * Messages between main and the storage worker (desktop architecture §2,
 * §7). Main has already validated every request at the IPC boundary; the
 * worker trusts main. Nothing is thrown across: every reply is a `Result`.
 *
 * Bytes travel as `Uint8Array`s whose buffers are transferred, so a
 * document crosses each boundary with one copy.
 *
 * No `node:*` imports: the dev storage host and unit tests dispatch to a
 * `Library` in-process with {@link dispatch}.
 */
import type { AppendInput, LoadedContent } from "./engine/content";
import { type StorageErrorEnvelope, toEnvelope } from "./engine/errors";
import type { Library, LibraryStatus } from "./engine/library";
import type {
  CreateDocInput,
  CreatedDoc,
  SidebarSnapshot,
} from "./engine/library-index";

/** Every request: `args` in, `result` out. */
export type StorageOps = {
  load: { args: { docId: string; owner: string }; result: LoadedContent };
  append: {
    args: { docId: string; owner: string; record: AppendInput };
    result: number;
  };
  compact: {
    args: { docId: string; owner: string; state: Uint8Array; upToSeq: number };
    result: { foreign: null };
  };
  /** Main replays its registry after a worker restart. */
  claim: { args: { docId: string; owner: string }; result: null };
  close: { args: { docId: string; owner: string }; result: null };
  releaseOwner: { args: { owner: string }; result: null };
  /** Resolves after every request sent before it: all durable. */
  flush: { args: Record<string, never>; result: null };
  stateOf: { args: { docId: string }; result: Uint8Array };
  sidebar: { args: Record<string, never>; result: SidebarSnapshot };
  createDoc: { args: CreateDocInput; result: CreatedDoc };
  createFolder: {
    args: { name: string; parentId?: string | null };
    result: { id: string; rev: number };
  };
  renameDoc: { args: { id: string; title: string }; result: number };
  moveDoc: {
    args: { id: string; folderId: string | null; sortKey: string };
    result: number;
  };
  trashDoc: { args: { id: string; group?: string | null }; result: number };
  restoreDoc: { args: { id: string }; result: number };
  purgeDoc: { args: { id: string }; result: number };
  createTag: {
    args: { name: string; color?: string | null };
    result: { id: string; rev: number };
  };
  setDocTags: { args: { docId: string; tagIds: string[] }; result: number };
  listDailyCopies: { args: Record<string, never>; result: string[] };
  readDailyCopy: { args: { date: string; docId: string }; result: Uint8Array };
  runIdleJobs: {
    args: Record<string, never>;
    result: { dailyCopy: string | null; purged: number };
  };
  stats: { args: Record<string, never>; result: ReturnType<Library["stats"]> };
  /** The quit flush's last step: checkpoint, clear `unclean_exit`, close. */
  shutdown: { args: Record<string, never>; result: null };
};

export type StorageOp = keyof StorageOps;

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: StorageErrorEnvelope };

/** main → worker */
export type StorageRequest = {
  [K in StorageOp]: { id: number; op: K; args: StorageOps[K]["args"] };
}[StorageOp];

/** worker → main */
export type StorageMessage =
  | { type: "ready"; status: LibraryStatus; openMs: number }
  | { type: "open_failed"; error: StorageErrorEnvelope }
  | { type: "reply"; id: number; result: Result<unknown> }
  /** Metadata changed (architecture §7 `index.changed`); main fans it out. */
  | { type: "index_changed"; rev: number };

/** Options the worker is started with (`workerData`). */
export type StorageWorkerOptions = {
  dir: string;
  fullfsync?: boolean;
  synchronous?: "FULL" | "OFF";
  /** Durability soak only: protocol lines on fd 1. */
  trace?: boolean;
  /** How often the worker looks for idle work, in ms (default 5000). */
  idlePollMs?: number;
};

/** Ops whose result is the new `rev`: each one emits `index_changed`. */
export const REV_OPS: ReadonlySet<StorageOp> = new Set<StorageOp>([
  "renameDoc",
  "moveDoc",
  "trashDoc",
  "restoreDoc",
  "purgeDoc",
  "setDocTags",
]);

/** Ops whose result carries `rev` in an object. */
const CREATE_OPS: ReadonlySet<StorageOp> = new Set<StorageOp>([
  "createDoc",
  "createFolder",
  "createTag",
]);

function run(library: Library, request: StorageRequest): unknown {
  switch (request.op) {
    case "load":
      return library.load(request.args.docId, request.args.owner);
    case "append":
      return library.append(
        request.args.docId,
        request.args.owner,
        request.args.record,
      );
    case "compact":
      return library.compact(
        request.args.docId,
        request.args.owner,
        request.args.state,
        request.args.upToSeq,
      );
    case "claim":
      library.claim(request.args.docId, request.args.owner);
      return null;
    case "close":
      library.close(request.args.docId, request.args.owner);
      return null;
    case "releaseOwner":
      library.releaseOwner(request.args.owner);
      return null;
    case "flush":
      return null;
    case "stateOf":
      return library.stateOf(request.args.docId);
    case "sidebar":
      return library.sidebar();
    case "createDoc":
      return library.createDoc(request.args);
    case "createFolder":
      return library.createFolder(request.args);
    case "renameDoc":
      return library.renameDoc(request.args.id, request.args.title);
    case "moveDoc":
      return library.moveDoc(
        request.args.id,
        request.args.folderId,
        request.args.sortKey,
      );
    case "trashDoc":
      return library.trashDoc(request.args.id, request.args.group ?? null);
    case "restoreDoc":
      return library.restoreDoc(request.args.id);
    case "purgeDoc":
      return library.purgeDoc(request.args.id);
    case "createTag":
      return library.createTag(request.args.name, request.args.color ?? null);
    case "setDocTags":
      return library.setDocTags(request.args.docId, request.args.tagIds);
    case "listDailyCopies":
      return library.listDailyCopies();
    case "readDailyCopy":
      return library.readDailyCopy(request.args.date, request.args.docId);
    case "runIdleJobs":
      return library.runIdleJobs();
    case "stats":
      return library.stats();
    case "shutdown":
      library.shutdown();
      return null;
  }
}

/**
 * Runs one request. Returns the reply, and the new `rev` when the request
 * changed metadata (the caller emits `index_changed`).
 */
export function dispatch(
  library: Library,
  request: StorageRequest,
): { result: Result<unknown>; rev: number | null } {
  try {
    const value = run(library, request);
    let rev: number | null = null;
    if (REV_OPS.has(request.op)) rev = value as number;
    else if (CREATE_OPS.has(request.op)) rev = (value as { rev: number }).rev;
    return { result: { ok: true, value }, rev };
  } catch (error) {
    return { result: { ok: false, error: toEnvelope(error) }, rev: null };
  }
}

/** The `ArrayBuffer`s in a value that can move instead of being copied. */
export function transferablesOf(value: unknown): ArrayBuffer[] {
  const found: ArrayBuffer[] = [];
  const seen = new Set<ArrayBuffer>();
  const visit = (item: unknown, depth: number) => {
    if (depth > 3 || item === null || typeof item !== "object") return;
    if (item instanceof Uint8Array) {
      const { buffer } = item;
      // Only a buffer the view owns whole; never a pooled or shared one.
      if (
        buffer instanceof ArrayBuffer &&
        item.byteOffset === 0 &&
        item.byteLength === buffer.byteLength &&
        !seen.has(buffer)
      ) {
        seen.add(buffer);
        found.push(buffer);
      }
      return;
    }
    if (Array.isArray(item)) {
      for (const entry of item) visit(entry, depth + 1);
      return;
    }
    for (const entry of Object.values(item)) visit(entry, depth + 1);
  };
  visit(value, 0);
  return found;
}
