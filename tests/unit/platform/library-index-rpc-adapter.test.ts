/**
 * `RpcLibraryIndex` beyond the shared contract: the title rule (G4), refused
 * writes, the change feed, and what each operation stores.
 */
import { afterEach, describe, expect, it } from "bun:test";

import { openBunSqlite } from "@/desktop/dev/bun-sqlite-driver";
import { Library } from "@/desktop/storage/engine/library";
import { createNodeHost } from "@/desktop/storage/node-host";
import {
  type LibraryCall,
  RpcLibraryIndex,
} from "@/lib/platform/desktop/library-index-rpc";
import {
  inProcessTransport,
  type LibraryTransport,
  readLoad,
  titleWriter,
} from "@/tests/helpers/library-index-harness";
import { createTempDir } from "@/tests/helpers/storage-library";

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function openLibrary(dir: string) {
  return Library.open({
    dir,
    host: createNodeHost(),
    openSqlite: openBunSqlite,
    fullfsync: false,
  });
}

function setup() {
  const temp = createTempDir("tinydocy-rpc-");
  let library = openLibrary(temp.dir);
  let transport = inProcessTransport(library);
  const errors: string[] = [];
  const indexOn = (
    on: LibraryTransport,
    call: LibraryCall = on.call,
  ): RpcLibraryIndex => {
    const index = new RpcLibraryIndex({
      call,
      renameTitle: titleWriter(on.call),
      initial: readLoad(library),
      onError: (_error, op) => errors.push(op),
    });
    on.onIndexChanged((rev, changes) => index.indexChanged(rev, changes));
    return index;
  };
  cleanups.push(() => {
    library.shutdown();
    temp.cleanUp();
  });
  return {
    errors,
    get library() {
      return library;
    },
    transport: () => transport,
    indexOn,
    /** Shuts the library down and opens it again with a fresh index. */
    async reopen(index: RpcLibraryIndex) {
      await index.settle();
      index.destroy();
      await transport.close();
      library = openLibrary(temp.dir);
      transport = inProcessTransport(library);
      return indexOn(transport);
    },
  };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("RpcLibraryIndex", () => {
  it("rename edits the title through a session, never the title column", async () => {
    const lib = setup();
    const calls: string[] = [];
    const index = new RpcLibraryIndex({
      call: lib.transport().call,
      initial: readLoad(lib.library),
      renameTitle: async (id, title) => {
        calls.push(`${id}:${title}`);
        await titleWriter(lib.transport().call)(id, title);
      },
    });
    const doc = index.create({ title: "Draft" });
    if (!doc) throw new Error("create was refused");
    index.rename(doc.id, "Final");
    expect(index.snapshot().items[0]?.title).toBe("Final");
    // After the document is stored: the session needs it.
    expect(calls).toEqual([]);
    await index.settle();
    expect(calls).toEqual([`${doc.id}:Final`]);
    const again = await lib.reopen(index);
    expect(again.snapshot().items.map((item) => item.title)).toEqual(["Final"]);
  });

  it("reports a refused write and reloads what storage holds", async () => {
    const lib = setup();
    const refuse: LibraryCall = (op, args) =>
      op === "createFolder"
        ? Promise.reject({ code: "io_error", message: "disk" })
        : lib.transport().call(op, args);
    const index = lib.indexOn(lib.transport(), refuse);
    const types: string[] = [];
    index.subscribe((type) => types.push(type));
    const folder = index.createFolder({ name: "Lost" });
    expect(index.snapshot().folders.map((f) => f.id)).toEqual([
      folder?.id ?? "",
    ]);
    await index.settle();
    expect(lib.errors).toEqual(["createFolder"]);
    expect(index.snapshot().folders).toEqual([]);
    expect(types).toEqual(["change", "load"]);
  });

  it("rolls back a create whose link key storage refuses (UNIQUE)", async () => {
    const lib = setup();
    const taken = lib.library.createDoc({ title: "Taken" });
    // A colliding key, as 2^-128 odds would give one: the engine refuses it.
    const collide: LibraryCall = (op, args) =>
      lib
        .transport()
        .call(
          op,
          op === "createDoc" ? { ...args, linkKey: taken.linkKey } : args,
        );
    const index = lib.indexOn(lib.transport(), collide);
    const doc = index.create({ title: "Clash" });
    expect(doc?.linkKey).toMatch(/^[0-9a-f]{32}$/);
    expect(index.snapshot().items.map((d) => d.title)).toEqual([
      "Taken",
      "Clash",
    ]);
    await index.settle();
    expect(lib.errors).toEqual(["createDoc"]);
    expect(index.snapshot().items.map((d) => [d.id, d.linkKey])).toEqual([
      [taken.id, taken.linkKey],
    ]);
    expect(lib.library.sidebar().docs.map((d) => d.id)).toEqual([taken.id]);
  });

  it("keeps later optimistic changes across a reload", async () => {
    const lib = setup();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow: LibraryCall = async (op, args) => {
      if (op === "createDoc") await gate;
      return lib.transport().call(op, args);
    };
    const index = lib.indexOn(lib.transport(), slow);
    const other = lib.indexOn(lib.transport());
    other.createFolder({ name: "Elsewhere" });
    await other.settle();
    // A reload, then a write that stays pending while it runs.
    const loading = index.load();
    const doc = index.create({ title: "Slow" });
    await loading;
    expect(index.snapshot().folders.map((f) => f.name)).toEqual(["Elsewhere"]);
    expect(index.snapshot().items.map((item) => item.id)).toEqual([
      doc?.id ?? "",
    ]);
    release();
    await index.settle();
    expect(index.snapshot().items.map((item) => item.title)).toEqual(["Slow"]);
  });

  it("follows another window's changes and skips its own", async () => {
    const lib = setup();
    const one = lib.indexOn(lib.transport());
    const two = lib.indexOn(lib.transport());
    let ownEvents = 0;
    one.subscribe(() => ownEvents++);
    one.createTag("Shared");
    await one.settle();
    await tick();
    expect(ownEvents).toBe(1);
    expect(two.snapshot().tags.map((tag) => tag.name)).toEqual(["Shared"]);
  });

  it("stores list choices, pins, Manual order and moves", async () => {
    const lib = setup();
    const index = lib.indexOn(lib.transport());
    const folder = index.createFolder({ name: "Box" });
    if (!folder) throw new Error("createFolder was refused");
    const [a, b, c] = ["A", "B", "C"].map((title) => index.create({ title }));
    index.moveInFolder(c?.id ?? "", 0);
    index.moveItems([{ kind: "doc", id: b?.id ?? "" }], folder.id);
    index.pin(a?.id ?? "");
    index.pin(c?.id ?? "");
    index.movePin(c?.id ?? "", 0);
    index.setListView(`folder:${folder.id}`, {
      sort: "title",
      view: "preview",
    });
    index.setListView("pinned", { sort: "manual" });
    const before = index.snapshot();
    const again = await lib.reopen(index);
    const after = again.snapshot();
    const shape = (items: typeof before.items) =>
      Object.fromEntries(
        items.map((item) => [
          item.title,
          [item.folderId ?? null, item.sortKey ?? null, item.pinKey ?? null],
        ]),
      );
    expect(shape(after.items)).toEqual(shape(before.items));
    expect(after.items.find((item) => item.id === b?.id)?.folderId).toBe(
      folder.id,
    );
    expect(after.listViews).toEqual({
      [`folder:${folder.id}`]: {
        sort: "title",
        descending: false,
        view: "preview",
      },
      pinned: { sort: "manual" },
    });
    expect(after.folders[0]?.createdAt).toBeGreaterThan(0);
  });

  it("purgeTrash empties the Trash for good", async () => {
    const lib = setup();
    const index = lib.indexOn(lib.transport());
    const folder = index.createFolder({ name: "Old" });
    index.create({ title: "Inside", folderId: folder?.id });
    const loose = index.create({ title: "Loose" });
    await index.trash([loose?.id ?? ""]);
    await index.trashFolder(folder?.id ?? "");
    expect(index.snapshot().trashCount).toBe(2);
    index.purgeTrash();
    expect(index.snapshot().trash).toEqual([]);
    expect(index.snapshot().trashed).toEqual([]);
    await index.settle();
    expect(lib.library.trashList()).toEqual({
      items: [],
      docCount: 0,
      trashed: [],
    });
    expect(lib.errors).toEqual([]);
  });
});
