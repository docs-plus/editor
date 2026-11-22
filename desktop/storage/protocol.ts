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
import type { DerivedRows } from "./engine/derive";
import { type StorageErrorEnvelope, toEnvelope } from "./engine/errors";
import type { FolderMoveItem } from "./engine/folders";
import type { Library, LibraryStatus } from "./engine/library";
import type {
  CreateDocInput,
  CreatedDoc,
  IndexChange,
  SidebarSnapshot,
} from "./engine/library-index";

/** The result of a `Library` method, as a reply carries it. */
type Out<K extends keyof Library> = Library[K] extends (
  ...args: never[]
) => infer R
  ? R
  : never;

type None = Record<string, never>;
type ById = { id: string };
type Keys = { keys: { id: string; key: string }[] };

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
    /** `id` is minted by the caller (the library port creates synchronously). */
    args: {
      id?: string;
      name: string;
      parentId?: string | null;
      sortKey?: string;
    };
    result: Out<"createFolder">;
  };
  // The library port (P2.6e: `lib/platform/desktop/library-index-rpc.ts`).
  renameFolder: { args: { id: string; name: string }; result: number };
  setFolderView: {
    args: {
      id: string;
      columns: {
        sort: string | null;
        view: string | null;
        group: string | null;
      };
    };
    result: number;
  };
  moveItems: {
    args: { items: FolderMoveItem[]; folderId: string | null };
    result: Out<"moveItems">;
  };
  trashFolder: { args: ById; result: Out<"trashFolder"> };
  restoreFolder: { args: ById; result: Out<"restoreFolder"> };
  purgeFolder: { args: ById; result: Out<"purgeFolder"> };
  duplicateDoc: { args: ById; result: Out<"duplicateDoc"> };
  markOpened: { args: ById; result: number };
  renameTag: { args: { id: string; name: string }; result: Out<"renameTag"> };
  mergeTags: {
    args: { fromId: string; intoId: string };
    result: Out<"mergeTags">;
  };
  addTag: { args: { docId: string; tagId: string }; result: Out<"addTag"> };
  removeTag: { args: { docId: string; tagId: string }; result: number };
  pinDoc: { args: { id: string; pinKey: string }; result: number };
  unpinDoc: { args: ById; result: number };
  setPinKeys: { args: Keys; result: number };
  setSortKeys: { args: Keys; result: number };
  setPlaceView: {
    args: { place: string; json: string | null };
    result: number;
  };
  placeViews: { args: None; result: Out<"placeViews"> };
  trashList: { args: None; result: Out<"trashList"> };
  snippets: { args: { ids: string[] }; result: Out<"snippets"> };
  searchTitles: { args: { query: string }; result: Out<"searchTitles"> };
  searchHeadings: { args: { query: string }; result: Out<"searchHeadings"> };
  // Derived rows (LK4a's `derive.put`; T21 times them).
  putDerived: {
    args: { docId: string; atSeq: number; rows: DerivedRows };
    result: Out<"putDerived">;
  };
  backlinks: { args: { linkKey: string }; result: Out<"backlinks"> };
  trashDoc: { args: { id: string }; result: number };
  restoreDoc: {
    args: { id: string };
    result: ReturnType<Library["restoreDoc"]>;
  };
  purgeDoc: { args: { id: string }; result: number };
  createTag: {
    /** `id` is the caller's when no tag has the name's key yet. */
    args: { name: string; color?: string | null; id?: string };
    result: ReturnType<Library["createTag"]>;
  };
  setDocTags: { args: { docId: string; tagIds: string[] }; result: number };
  listDailyCopies: { args: Record<string, never>; result: string[] };
  readDailyCopy: { args: { date: string; docId: string }; result: Uint8Array };
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
  | { type: "index_changed"; rev: number; changes: IndexChange[] };

/** Options the worker is started with (`workerData`). */
export type StorageWorkerOptions = {
  dir: string;
  fullfsync?: boolean;
  synchronous?: "FULL" | "OFF";
  /** Durability soak only: protocol lines on fd 1. */
  trace?: boolean;
  /** How often the worker looks for idle work, in ms (default 5000). */
  idlePollMs?: number;
  /** Soak only: how long without a write counts as idle (default 30 s). */
  idleMs?: number;
  /**
   * The daily-copy thread's bundle (`copy-worker.cjs`). `StorageClient`
   * defaults it to the worker's sibling. Without it, no daily copy runs.
   */
  copyWorkerPath?: string;
};

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
    case "renameFolder":
      return library.renameFolder(request.args.id, request.args.name);
    case "setFolderView":
      return library.setFolderView(request.args.id, request.args.columns);
    case "moveItems":
      return library.moveItems(request.args.items, request.args.folderId);
    case "trashFolder":
      return library.trashFolder(request.args.id);
    case "restoreFolder":
      return library.restoreFolder(request.args.id);
    case "purgeFolder":
      return library.purgeFolder(request.args.id);
    case "duplicateDoc":
      return library.duplicateDoc(request.args.id);
    case "markOpened":
      return library.markOpened(request.args.id);
    case "renameTag":
      return library.renameTag(request.args.id, request.args.name);
    case "mergeTags":
      return library.mergeTags(request.args.fromId, request.args.intoId);
    case "addTag":
      return library.addTag(request.args.docId, request.args.tagId);
    case "removeTag":
      return library.removeTag(request.args.docId, request.args.tagId);
    case "pinDoc":
      return library.pinDoc(request.args.id, request.args.pinKey);
    case "unpinDoc":
      return library.unpinDoc(request.args.id);
    case "setPinKeys":
      return library.setPinKeys(request.args.keys);
    case "setSortKeys":
      return library.setSortKeys(request.args.keys);
    case "setPlaceView":
      return library.setPlaceView(request.args.place, request.args.json);
    case "placeViews":
      return library.placeViews();
    case "trashList":
      return library.trashList();
    case "snippets":
      return library.snippets(request.args.ids);
    case "searchTitles":
      return library.searchTitles(request.args.query);
    case "searchHeadings":
      return library.searchHeadings(request.args.query);
    case "putDerived":
      return library.putDerived(
        request.args.docId,
        request.args.atSeq,
        request.args.rows,
      );
    case "backlinks":
      return library.backlinks(request.args.linkKey);
    case "trashDoc":
      return library.trashDoc(request.args.id);
    case "restoreDoc":
      return library.restoreDoc(request.args.id);
    case "purgeDoc":
      return library.purgeDoc(request.args.id);
    case "createTag":
      return library.createTag(
        request.args.name,
        request.args.color ?? null,
        request.args.id,
      );
    case "setDocTags":
      return library.setDocTags(request.args.docId, request.args.tagIds);
    case "listDailyCopies":
      return library.listDailyCopies();
    case "readDailyCopy":
      return library.readDailyCopy(request.args.date, request.args.docId);
    case "stats":
      return library.stats();
    case "shutdown":
      library.shutdown();
      return null;
  }
}

/** Runs one request; a failure becomes an envelope, never a throw. */
export function dispatch(
  library: Library,
  request: StorageRequest,
): Result<unknown> {
  try {
    return { ok: true, value: run(library, request) };
  } catch (error) {
    return { ok: false, error: toEnvelope(error) };
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
