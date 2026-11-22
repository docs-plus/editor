import { describe, expect, it } from "bun:test";

import type {
  DocumentEntry,
  DocumentIndex,
  DocumentIndexEventType,
  FolderEntry,
  LibraryIndex,
} from "@/lib/platform/document-index";

/**
 * The `DocumentIndex` contract (`lib/platform/document-index.ts`), run on
 * every implementation. Rules one host adds (the sandbox's Playground, the
 * tab cap) are tested with that host.
 */

export interface ContractHarness {
  index: DocumentIndex;
  /** Ids the implementation always lists first (the sandbox's Playground). */
  fixed: readonly string[];
  /** Makes a `deferLoad` index ready. */
  load(): void;
  /** Makes trashed documents unrecoverable. */
  purge(): void;
}

export interface ContractOptions {
  items?: readonly DocumentEntry[];
  deferLoad?: boolean;
  /** Ids whose trash request fails. */
  failTrash?: readonly string[];
}

export type ContractFactory = (options: ContractOptions) => ContractHarness;

const a: DocumentEntry = { id: "doc-a", title: "A", createdAt: 1 };
const b: DocumentEntry = { id: "doc-b", title: "B", createdAt: 2 };
const c: DocumentEntry = { id: "doc-c", title: "C", createdAt: 3 };

type Event = { type: DocumentIndexEventType; rev: number; ids: string[] };

function record(index: DocumentIndex): Event[] {
  const events: Event[] = [];
  index.subscribe((type, snapshot) =>
    events.push({
      type,
      rev: snapshot.rev,
      ids: snapshot.items.map((item) => item.id),
    }),
  );
  return events;
}

export function describeDocumentIndexContract(
  name: string,
  create: ContractFactory,
): void {
  describe(`DocumentIndex contract: ${name}`, () => {
    function setup(options: ContractOptions = {}) {
      const harness = create({ items: [a, b, c], ...options });
      const { index, fixed } = harness;
      const ids = () => index.snapshot().items.map((item) => item.id);
      /** Position of the first non-fixed entry. */
      const at = (i: number) => fixed.length + i;
      return { ...harness, index, fixed, ids, at };
    }

    describe("snapshot and events", () => {
      it("lists the entries in order once ready", () => {
        const { index, fixed, ids } = setup();
        const snapshot = index.snapshot();
        expect(snapshot.ready).toBe(true);
        expect(snapshot.rev).toBeGreaterThan(0);
        expect(ids()).toEqual([...fixed, a.id, b.id, c.id]);
        expect(snapshot.items.find((item) => item.id === b.id)).toEqual(b);
      });

      it("keeps the same snapshot until a change, then grows rev", () => {
        const { index } = setup();
        const before = index.snapshot();
        expect(index.snapshot()).toBe(before);
        index.rename(a.id, "A2");
        const after = index.snapshot();
        expect(after).not.toBe(before);
        expect(after.rev).toBeGreaterThan(before.rev);
        expect(index.snapshot()).toBe(after);
      });

      it("notifies a change synchronously, with the new snapshot", () => {
        const { index } = setup();
        const events = record(index);
        index.rename(b.id, "B2");
        expect(events).toEqual([
          {
            type: "change",
            rev: index.snapshot().rev,
            ids: index.snapshot().items.map((item) => item.id),
          },
        ]);
      });

      it("stops notifying after unsubscribe", () => {
        const { index } = setup();
        let calls = 0;
        const unsubscribe = index.subscribe(() => calls++);
        index.rename(a.id, "A2");
        unsubscribe();
        index.rename(a.id, "A3");
        expect(calls).toBe(1);
      });

      it("is empty and refuses mutations until loaded, then emits load", () => {
        const { index, fixed, ids, load } = setup({ deferLoad: true });
        expect(index.snapshot().ready).toBe(false);
        expect(index.snapshot().items).toEqual([]);
        expect(index.create()).toBeNull();
        const events = record(index);

        load();

        expect(index.snapshot().ready).toBe(true);
        expect(ids()).toEqual([...fixed, a.id, b.id, c.id]);
        expect(events.map((event) => event.type)).toEqual(["load"]);
      });

      it("ignores mutations and notifies nothing after destroy", async () => {
        const { index, ids } = setup();
        const events = record(index);
        const before = ids();
        index.destroy();
        expect(index.create()).toBeNull();
        index.rename(a.id, "gone");
        index.move(a.id, 2);
        expect(ids()).toEqual(before);
        expect(events).toEqual([]);
        expect(await index.restore([{ id: a.id, title: "A" }])).toBeNull();
      });
    });

    describe("create, rename and move", () => {
      it("create appends an Untitled entry and returns it", () => {
        const { index, fixed, ids } = setup();
        const events = record(index);
        const entry = index.create();
        if (!entry) throw new Error("create was refused");
        expect(entry.title).toBe("Untitled");
        expect(typeof entry.createdAt).toBe("number");
        expect(ids()).toEqual([...fixed, a.id, b.id, c.id, entry.id]);
        expect(index.snapshot().items.at(-1)).toEqual(entry);
        expect(events).toHaveLength(1);
      });

      it("create takes a title and makes unique ids", () => {
        const { index } = setup();
        const one = index.create({ title: "Notes" });
        const two = index.create({ title: "Notes" });
        expect(one?.title).toBe("Notes");
        expect(one?.id).not.toBe(two?.id);
      });

      it("rename changes the title in place", () => {
        const { index, ids, at } = setup();
        const before = ids();
        index.rename(b.id, "Renamed");
        expect(ids()).toEqual(before);
        expect(index.snapshot().items[at(1)]).toEqual({
          ...b,
          title: "Renamed",
        });
      });

      it("rename of an unknown id changes nothing", () => {
        const { index } = setup();
        const before = index.snapshot();
        const events = record(index);
        index.rename("doc-missing", "x");
        expect(index.snapshot()).toBe(before);
        expect(events).toEqual([]);
      });

      it("move puts the entry at the position asked", () => {
        const { index, fixed, ids, at } = setup();
        index.move(a.id, at(2));
        expect(ids()).toEqual([...fixed, b.id, c.id, a.id]);
        index.move(a.id, at(0));
        expect(ids()).toEqual([...fixed, a.id, b.id, c.id]);
      });

      it("move clamps past the end and ignores unknown ids", () => {
        const { index, fixed, ids, at } = setup();
        index.move(a.id, at(99));
        expect(ids()).toEqual([...fixed, b.id, c.id, a.id]);
        const before = index.snapshot();
        index.move("doc-missing", at(0));
        index.move(a.id, at(2));
        expect(index.snapshot()).toBe(before);
      });
    });

    describe("trash and restore", () => {
      it("trash unlists the entries and returns where they were", async () => {
        const { index, fixed, ids } = setup();
        const events = record(index);
        const result = await index.trash([b.id]);
        expect(result.failed).toEqual([]);
        expect(result.trashed).toHaveLength(1);
        expect(result.trashed[0]).toMatchObject({ id: b.id, title: b.title });
        expect(ids()).toEqual([...fixed, a.id, c.id]);
        expect(events.at(-1)?.type).toBe("change");
      });

      it("trash reports ids it cannot trash and keeps them listed", async () => {
        const { index, fixed, ids } = setup({ failTrash: [c.id] });
        const result = await index.trash([a.id, c.id, "doc-missing"]);
        expect(result.trashed.map((entry) => entry.id)).toEqual([a.id]);
        expect([...result.failed].sort()).toEqual([c.id, "doc-missing"].sort());
        expect(ids()).toEqual([...fixed, b.id, c.id]);
      });

      it("restore puts trashed entries back where they were", async () => {
        const { index, fixed, ids } = setup();
        const { trashed } = await index.trash([a.id, c.id]);
        expect(ids()).toEqual([...fixed, b.id]);

        const results = await index.restore(trashed);

        expect(results).toEqual({ [a.id]: "restored", [c.id]: "restored" });
        expect(ids()).toEqual([...fixed, a.id, b.id, c.id]);
      });

      it("restore without a position appends", async () => {
        const { index, fixed, ids } = setup();
        await index.trash([a.id]);
        await index.restore([{ id: a.id, title: a.title }]);
        expect(ids()).toEqual([...fixed, b.id, c.id, a.id]);
      });

      it("restore of a listed document answers not_closed and lists it once", async () => {
        const { index, ids } = setup();
        const before = ids();
        const results = await index.restore([{ id: b.id, title: b.title }]);
        expect(results).toEqual({ [b.id]: "not_closed" });
        expect(ids()).toEqual(before);
      });

      it("restore of a purged document answers gone", async () => {
        const { index, fixed, ids, purge } = setup();
        const { trashed } = await index.trash([a.id]);
        purge();
        expect(await index.restore(trashed)).toEqual({ [a.id]: "gone" });
        expect(ids()).toEqual([...fixed, b.id, c.id]);
      });

      it("restore of nothing asks nothing", async () => {
        const { index } = setup();
        expect(await index.restore([])).toBeNull();
      });
    });
  });
}

export interface LibraryContractOptions {
  items?: readonly DocumentEntry[];
  folders?: readonly FolderEntry[];
  deferLoad?: boolean;
}

export interface LibraryContractHarness {
  index: LibraryIndex;
  load(): void;
  /** Makes trashed documents and folders unrecoverable. */
  purge(): void;
}

export type LibraryContractFactory = (
  options: LibraryContractOptions,
) => LibraryContractHarness;

const folder = (
  id: string,
  parentId: string | null,
  name = id,
): FolderEntry => ({ id, name, parentId, createdAt: 1 });

/**
 * The `LibraryIndex` additions (folders, pins, folder trash), run on every
 * library implementation: `MemoryDocumentIndex` here, the desktop
 * `IpcDocumentIndex` (P2.6) and the web `IdbDocumentIndex` (W2) later.
 */
export function describeLibraryIndexContract(
  name: string,
  create: LibraryContractFactory,
): void {
  describe(`LibraryIndex contract: ${name}`, () => {
    // work ─ q4 ─ deep ─ deepest      (4 levels)
    // home
    const work = folder("f-work", null, "Work");
    const q4 = folder("f-q4", "f-work", "Q4");
    const deep = folder("f-deep", "f-q4", "Deep");
    const deepest = folder("f-deepest", "f-deep", "Deepest");
    const home = folder("f-home", null, "Home");
    const plan: DocumentEntry = {
      id: "doc-plan",
      title: "Plan",
      createdAt: 1,
      folderId: "f-q4",
    };
    const notes: DocumentEntry = {
      id: "doc-notes",
      title: "Notes",
      createdAt: 2,
    };
    const list: DocumentEntry = {
      id: "doc-list",
      title: "List",
      createdAt: 3,
      folderId: "f-deepest",
    };

    function setup(options: LibraryContractOptions = {}) {
      const harness = create({
        items: [plan, notes, list],
        folders: [work, q4, deep, deepest, home],
        ...options,
      });
      const { index } = harness;
      const doc = (id: string) =>
        index.snapshot().items.find((item) => item.id === id);
      const dir = (id: string) =>
        index.snapshot().folders.find((item) => item.id === id);
      const docIds = () => index.snapshot().items.map((item) => item.id);
      const dirIds = () =>
        index
          .snapshot()
          .folders.map((item) => item.id)
          .sort();
      return { ...harness, index, doc, dir, docIds, dirIds };
    }

    describe("snapshot", () => {
      it("lists folders, each document's folder and an empty Trash", () => {
        const { index, doc, dirIds } = setup();
        expect(dirIds()).toEqual(
          [work, q4, deep, deepest, home].map((x) => x.id).sort(),
        );
        expect(doc(plan.id)?.folderId).toBe(q4.id);
        expect(doc(notes.id)?.folderId ?? null).toBeNull();
        expect(index.snapshot().trashCount).toBe(0);
      });

      it("is empty until loaded", () => {
        const { index, load, dirIds } = setup({ deferLoad: true });
        expect(index.snapshot().folders).toEqual([]);
        expect(index.createFolder({ name: "X" })).toBeNull();
        load();
        expect(dirIds()).toHaveLength(5);
      });
    });

    describe("folders", () => {
      it("createFolder lists a folder at the root or inside another", () => {
        const { index, dir } = setup();
        const events = record(index);
        const top = index.createFolder({ name: "  Drafts  " });
        const inner = index.createFolder({ name: "Old", parentId: work.id });
        if (!top || !inner) throw new Error("createFolder was refused");
        expect(top).toMatchObject({ name: "Drafts", parentId: null });
        expect(inner.parentId).toBe(work.id);
        expect(dir(top.id)).toEqual(top);
        expect(top.id).not.toBe(inner.id);
        expect(events).toHaveLength(2);
      });

      it("createFolder refuses an unknown parent, a fifth level and no name", () => {
        const { index } = setup();
        const before = index.snapshot();
        expect(
          index.createFolder({ name: "X", parentId: "f-nope" }),
        ).toBeNull();
        expect(
          index.createFolder({ name: "X", parentId: deepest.id }),
        ).toBeNull();
        expect(index.createFolder({ name: "   " })).toBeNull();
        expect(index.snapshot()).toBe(before);
      });

      it("renameFolder renames in place and ignores a blank name", () => {
        const { index, dir } = setup();
        index.renameFolder(home.id, " House ");
        expect(dir(home.id)?.name).toBe("House");
        const before = index.snapshot();
        index.renameFolder(home.id, "  ");
        index.renameFolder("f-nope", "X");
        expect(index.snapshot()).toBe(before);
      });

      it("create puts a document in a folder, and refuses an unknown one", () => {
        const { index, doc } = setup();
        const entry = index.create({ title: "In Home", folderId: home.id });
        if (!entry) throw new Error("create was refused");
        expect(doc(entry.id)?.folderId).toBe(home.id);
        expect(index.create({ folderId: "f-nope" })).toBeNull();
      });
    });

    describe("moveItems", () => {
      it("moves documents and folders, and says where they were", () => {
        const { index, doc, dir } = setup();
        const result = index.moveItems(
          [
            { kind: "doc", id: notes.id },
            { kind: "folder", id: home.id },
          ],
          work.id,
        );
        expect(result).toEqual({
          ok: true,
          from: { [`doc:${notes.id}`]: null, [`folder:${home.id}`]: null },
        });
        expect(doc(notes.id)?.folderId).toBe(work.id);
        expect(dir(home.id)?.parentId).toBe(work.id);
        index.moveItems([{ kind: "doc", id: plan.id }], null);
        expect(doc(plan.id)?.folderId ?? null).toBeNull();
      });

      it("refuses a folder into its own descendant, moving nothing", () => {
        const { index } = setup();
        const before = index.snapshot();
        const events = record(index);
        expect(
          index.moveItems(
            [
              { kind: "doc", id: notes.id },
              { kind: "folder", id: work.id },
            ],
            deep.id,
          ),
        ).toEqual({ ok: false, reason: "into_itself" });
        expect(index.moveItems([{ kind: "folder", id: q4.id }], q4.id)).toEqual(
          { ok: false, reason: "into_itself" },
        );
        expect(index.snapshot()).toBe(before);
        expect(events).toEqual([]);
      });

      it("refuses nesting past 4 levels", () => {
        const { index } = setup();
        const sub = index.createFolder({ name: "Sub", parentId: home.id });
        if (!sub) throw new Error("createFolder was refused");
        // Home (2 levels) under Deep (level 3) would reach level 5.
        expect(
          index.moveItems([{ kind: "folder", id: home.id }], deep.id),
        ).toEqual({ ok: false, reason: "too_deep" });
        expect(
          index.moveItems([{ kind: "folder", id: home.id }], q4.id).ok,
        ).toBe(true);
      });

      it("refuses unknown items and destinations", () => {
        const { index } = setup();
        expect(
          index.moveItems([{ kind: "doc", id: "doc-nope" }], null),
        ).toEqual({ ok: false, reason: "not_found" });
        expect(
          index.moveItems([{ kind: "doc", id: notes.id }], "f-nope"),
        ).toEqual({ ok: false, reason: "not_found" });
      });

      it("changes nothing when everything is already there", () => {
        const { index } = setup();
        const before = index.snapshot();
        const result = index.moveItems([{ kind: "doc", id: plan.id }], q4.id);
        expect(result.ok).toBe(true);
        expect(index.snapshot()).toBe(before);
      });
    });

    describe("pins", () => {
      const pinned = (index: LibraryIndex) =>
        index
          .snapshot()
          .items.filter((item) => item.pinKey !== undefined)
          .sort((x, y) =>
            (x.pinKey ?? "") < (y.pinKey ?? "")
              ? -1
              : (x.pinKey ?? "") > (y.pinKey ?? "")
                ? 1
                : 0,
          )
          .map((item) => item.id);

      it("pins at the end, unpins, and ignores a second pin", () => {
        const { index } = setup();
        index.pin(list.id);
        index.pin(plan.id);
        const before = index.snapshot();
        index.pin(list.id);
        expect(index.snapshot()).toBe(before);
        expect(pinned(index)).toEqual([list.id, plan.id]);
        index.unpin(list.id);
        expect(pinned(index)).toEqual([plan.id]);
      });

      it("movePin reorders the pinned documents", () => {
        const { index } = setup();
        index.pin(list.id);
        index.pin(plan.id);
        index.pin(notes.id);
        index.movePin(notes.id, 0);
        expect(pinned(index)).toEqual([notes.id, list.id, plan.id]);
        index.movePin(notes.id, 2);
        expect(pinned(index)).toEqual([list.id, plan.id, notes.id]);
      });
    });

    it("markOpened stamps the time it was opened", () => {
      const { index, doc } = setup();
      const before = Date.now();
      index.markOpened(notes.id);
      expect(doc(notes.id)?.openedAt).toBeGreaterThanOrEqual(before);
    });

    describe("trash", () => {
      it("trashes a folder with everything in it, as one unit", async () => {
        const { index, docIds, dirIds } = setup();
        const trashed = await index.trashFolder(q4.id);
        expect(trashed).toEqual({
          id: q4.id,
          name: q4.name,
          parentId: work.id,
          docCount: 2,
        });
        expect(docIds()).toEqual([notes.id]);
        expect(dirIds()).toEqual([home.id, work.id].sort());
        expect(index.snapshot().trashCount).toBe(2);

        expect(await index.restoreFolder(q4.id)).toBe("restored");
        expect(docIds().sort()).toEqual([plan.id, notes.id, list.id].sort());
        expect(dirIds()).toHaveLength(5);
        expect(index.snapshot().trashCount).toBe(0);
      });

      it("restores to the root when the parent folder is gone", async () => {
        const { index, dir, doc } = setup();
        await index.trashFolder(deep.id);
        const { trashed } = await index.trash([notes.id]);
        await index.trashFolder(work.id);
        expect(await index.restoreFolder(deep.id)).toBe("restored_to_root");
        expect(dir(deep.id)?.parentId).toBeNull();
        expect(doc(list.id)?.folderId).toBe(deepest.id);
        await index.restore(trashed);
        expect(doc(notes.id)?.folderId ?? null).toBeNull();
      });

      it("restores a document into a trashed folder at the root", async () => {
        const { index, doc } = setup();
        const { trashed } = await index.trash([plan.id]);
        await index.trashFolder(q4.id);
        expect(await index.restore(trashed)).toEqual({ [plan.id]: "restored" });
        expect(doc(plan.id)?.folderId ?? null).toBeNull();
      });

      it("answers gone for an unknown or purged folder", async () => {
        const { index, purge } = setup();
        expect(await index.restoreFolder("f-nope")).toBe("gone");
        await index.trashFolder(home.id);
        purge();
        expect(await index.restoreFolder(home.id)).toBe("gone");
        expect(await index.trashFolder("f-nope")).toBeNull();
      });
    });

    it("refuses folder and pin operations after destroy", async () => {
      const { index } = setup();
      const before = index.snapshot();
      index.destroy();
      expect(index.createFolder({ name: "X" })).toBeNull();
      expect(index.moveItems([{ kind: "doc", id: notes.id }], work.id)).toEqual(
        { ok: false, reason: "not_ready" },
      );
      index.pin(notes.id);
      index.renameFolder(work.id, "W");
      expect(await index.trashFolder(work.id)).toBeNull();
      expect(index.snapshot()).toBe(before);
    });
  });
}
