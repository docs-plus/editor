import { describe, expect, it } from "bun:test";

import type {
  DocumentEntry,
  DocumentIndex,
  DocumentIndexEventType,
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
