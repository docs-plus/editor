import { afterEach, describe, expect, it } from "bun:test";

import * as Y from "yjs";

import { PLAYGROUND_ID } from "@/lib/constants";
import type {
  DocumentEntry,
  RestoreResult,
} from "@/lib/platform/document-index";
import {
  GlobalTabsIndex,
  type GlobalTabsSource,
} from "@/lib/platform/web/global-tabs-index";
import type { Tab } from "@/lib/tab-entry";
import {
  type ContractOptions,
  describeDocumentIndexContract,
} from "@/tests/unit/platform/document-index-contract";

const TABS_KEY = "tinydocy-tabs";
const playground: Tab = {
  id: PLAYGROUND_ID,
  title: "Playground",
  createdAt: 0,
};

/** The server side of trash and restore, and what the source was asked. */
class FakeServer {
  readonly closed = new Map<string, string>();
  readonly purged = new Set<string>();
  readonly forgotten: string[] = [];
  readonly kept: Set<string>[] = [];
  released = 0;
  /** Answer every restore with null (a network error). */
  offline = false;

  constructor(private readonly failClose: ReadonlySet<string> = new Set()) {}

  async close(id: string, title: string): Promise<boolean> {
    if (this.failClose.has(id)) return false;
    this.closed.set(id, title);
    return true;
  }

  async restore(ids: string[]): Promise<Record<string, RestoreResult> | null> {
    if (this.offline) return null;
    const results: Record<string, RestoreResult> = {};
    for (const id of ids) {
      if (this.closed.delete(id)) results[id] = "restored";
      else results[id] = this.purged.has(id) ? "gone" : "not_closed";
    }
    return results;
  }

  purge(): void {
    for (const id of this.closed.keys()) this.purged.add(id);
    this.closed.clear();
  }
}

interface WebHarness {
  index: GlobalTabsIndex;
  doc: Y.Doc;
  server: FakeServer;
  /** Fires the sync handler: the device copy (false) or the server (true). */
  sync(serverSynced?: boolean): void;
}

/** A shared tab list that the server already bootstrapped. */
function bootstrappedDoc(items: readonly DocumentEntry[]): Y.Doc {
  const doc = new Y.Doc();
  doc.transact(() => {
    doc.getMap("meta").set("bootstrapped", true);
    doc.getArray<unknown>("tabs").insert(0, [playground, ...items]);
  });
  return doc;
}

function createWeb(
  doc: Y.Doc,
  options: { deferLoad?: boolean; failTrash?: readonly string[] } = {},
): WebHarness {
  const server = new FakeServer(new Set(options.failTrash));
  let handler: ((serverSynced: boolean) => void) | null = null;
  const source: GlobalTabsSource = {
    doc,
    onSynced: (h) => {
      handler = h;
      if (!options.deferLoad) h(true);
      return () => {
        handler = null;
      };
    },
    release: () => {
      server.released++;
    },
    closeDocument: (id, title) => server.close(id, title),
    restoreDocuments: (ids) => server.restore(ids),
    forgetDocument: (id) => server.forgotten.push(id),
    keepOnly: (ids) => server.kept.push(new Set(ids)),
  };
  const index = new GlobalTabsIndex(source);
  return {
    index,
    doc,
    server,
    sync: (serverSynced = true) => handler?.(serverSynced),
  };
}

/** Apply everything `from` has that `to` lacks, as a sync message would. */
function syncFrom(from: Y.Doc, to: Y.Doc): void {
  Y.applyUpdate(
    to,
    Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)),
    "remote",
  );
}

function rawIds(doc: Y.Doc): unknown[] {
  return doc
    .getArray<unknown>("tabs")
    .toArray()
    .map((entry) => (entry as { id?: unknown }).id);
}

describeDocumentIndexContract(
  "GlobalTabsIndex",
  ({ items = [], ...options }: ContractOptions) => {
    const web = createWeb(bootstrappedDoc(items), options);
    return {
      index: web.index,
      fixed: [PLAYGROUND_ID],
      load: () => web.sync(),
      purge: () => web.server.purge(),
    };
  },
);

const tabA: Tab = { id: "doc-a", title: "A", createdAt: 1 };
const tabB: Tab = { id: "doc-b", title: "B", createdAt: 2 };

function ids(web: WebHarness): string[] {
  return web.index.snapshot().items.map((item) => item.id);
}

describe("GlobalTabsIndex: Playground", () => {
  it("is always listed first, even when the shared list lacks it", () => {
    const doc = new Y.Doc();
    doc.transact(() => {
      doc.getMap("meta").set("bootstrapped", true);
      doc.getArray("tabs").insert(0, [tabA]);
    });
    expect(ids(createWeb(doc))).toEqual([PLAYGROUND_ID, tabA.id]);
  });

  it("cannot be trashed", async () => {
    const web = createWeb(bootstrappedDoc([tabA]));
    const result = await web.index.trash([PLAYGROUND_ID]);
    expect(result).toEqual({ trashed: [], failed: [PLAYGROUND_ID] });
    expect(web.server.closed.size).toBe(0);
  });

  it("cannot be moved, and nothing moves above it", () => {
    const web = createWeb(bootstrappedDoc([tabA, tabB]));
    web.index.move(PLAYGROUND_ID, 2);
    expect(ids(web)).toEqual([PLAYGROUND_ID, tabA.id, tabB.id]);
    web.index.move(tabB.id, 0);
    expect(ids(web)).toEqual([PLAYGROUND_ID, tabB.id, tabA.id]);
  });

  it("restore never puts a tab above it", async () => {
    const web = createWeb(bootstrappedDoc([tabA, tabB]));
    await web.index.trash([tabA.id]);
    await web.index.restore([{ id: tabA.id, title: "A", index: 0 }]);
    expect(ids(web)).toEqual([PLAYGROUND_ID, tabA.id, tabB.id]);
  });
});

describe("GlobalTabsIndex: loading and bootstrap", () => {
  afterEach(() => localStorage.clear());

  it("seeds an empty list on the first server sync only", () => {
    const web = createWeb(new Y.Doc(), { deferLoad: true });
    const types: string[] = [];
    web.index.subscribe((type) => types.push(type));

    web.sync(false); // the device copy: not a server answer
    expect(web.index.snapshot().ready).toBe(true);
    expect(web.doc.getArray("tabs").length).toBe(0);
    expect(web.server.kept).toEqual([]);

    web.sync(true);
    const listed = ids(web);
    expect(listed).toHaveLength(2);
    expect(listed[0]).toBe(PLAYGROUND_ID);
    expect(web.index.snapshot().items[1].title).toBe("Untitled");
    expect(web.doc.getMap("meta").get("bootstrapped")).toBe(true);
    // Device copy, then the seed, then the server sync.
    expect(types).toEqual(["load", "change", "load"]);
    expect(web.server.kept).toEqual([new Set(listed)]);
  });

  it("never seeds a list that was bootstrapped and emptied", () => {
    const doc = new Y.Doc();
    doc.getMap("meta").set("bootstrapped", true);
    const web = createWeb(doc);
    expect(doc.getArray("tabs").length).toBe(0);
    expect(ids(web)).toEqual([PLAYGROUND_ID]);
  });

  it("seeds from the legacy local list and keeps the active tab id", () => {
    localStorage.setItem(
      TABS_KEY,
      JSON.stringify({ tabs: [playground, tabA], activeTabId: tabA.id }),
    );
    const web = createWeb(new Y.Doc());
    expect(ids(web)).toEqual([PLAYGROUND_ID, tabA.id]);
    expect(JSON.parse(localStorage.getItem(TABS_KEY) ?? "{}")).toEqual({
      tabs: [],
      activeTabId: tabA.id,
    });
  });

  it("emits load again on every server sync (a reconnect)", () => {
    const web = createWeb(bootstrappedDoc([tabA]));
    const types: string[] = [];
    web.index.subscribe((type) => types.push(type));
    const rev = web.index.snapshot().rev;
    web.sync(true);
    expect(types).toEqual(["load"]);
    expect(web.index.snapshot().rev).toBe(rev + 1);
    expect(web.server.kept).toHaveLength(2);
  });
});

describe("GlobalTabsIndex: the shared list", () => {
  it("lists a collaborator's changes as change events", () => {
    const web = createWeb(bootstrappedDoc([tabA]));
    const remote = new Y.Doc();
    syncFrom(web.doc, remote);
    const types: string[] = [];
    web.index.subscribe((type) => types.push(type));

    remote.getArray<Tab>("tabs").push([tabB]);
    syncFrom(remote, web.doc);

    expect(ids(web)).toEqual([PLAYGROUND_ID, tabA.id, tabB.id]);
    expect(types).toEqual(["change"]);
  });

  it("ignores malformed and duplicate entries", () => {
    const web = createWeb(bootstrappedDoc([tabA]));
    const remote = new Y.Doc();
    syncFrom(web.doc, remote);
    remote
      .getArray<unknown>("tabs")
      .push([
        { id: "../etc", title: "x", createdAt: 1 },
        { id: tabA.id, title: "dup", createdAt: 9 },
        { nope: true },
        tabB,
      ]);
    syncFrom(remote, web.doc);
    expect(ids(web)).toEqual([PLAYGROUND_ID, tabA.id, tabB.id]);
  });

  it("move rewrites the stored list without the malformed entries", () => {
    const doc = bootstrappedDoc([tabA, tabB]);
    doc.getArray<unknown>("tabs").push([{ nope: true }]);
    const web = createWeb(doc);
    web.index.move(tabB.id, 1);
    expect(rawIds(doc)).toEqual([PLAYGROUND_ID, tabB.id, tabA.id]);
  });

  it("caps titles", () => {
    const web = createWeb(bootstrappedDoc([tabA]));
    web.index.rename(tabA.id, "x".repeat(500));
    expect(web.index.snapshot().items[1].title).toHaveLength(200);
  });

  it("trash sends the title, unlists every duplicate in one transaction and forgets the copy", async () => {
    const doc = bootstrappedDoc([tabA, tabB]);
    doc.getArray<unknown>("tabs").push([tabA]);
    const web = createWeb(doc);
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);

    const result = await web.index.trash([tabA.id]);

    expect(web.server.closed.get(tabA.id)).toBe("A");
    expect(rawIds(doc)).toEqual([PLAYGROUND_ID, tabB.id]);
    expect(transactions).toBe(1);
    expect(web.server.forgotten).toEqual([tabA.id]);
    expect(result.trashed).toEqual([{ id: tabA.id, title: "A", index: 1 }]);
  });

  it("restore keeps the trashed list position across a collaborator's change", async () => {
    const web = createWeb(bootstrappedDoc([tabA, tabB]));
    const { trashed } = await web.index.trash([tabB.id]);
    web.index.create({ title: "C" });
    await web.index.restore(trashed);
    expect(ids(web).slice(0, 3)).toEqual([PLAYGROUND_ID, tabA.id, tabB.id]);
  });

  it("a failed restore answers null and changes nothing", async () => {
    const web = createWeb(bootstrappedDoc([tabA, tabB]));
    const { trashed } = await web.index.trash([tabA.id]);
    web.server.offline = true;
    expect(await web.index.restore(trashed)).toBeNull();
    expect(ids(web)).toEqual([PLAYGROUND_ID, tabB.id]);
  });
});

describe("GlobalTabsIndex: destroy", () => {
  it("releases the source once and stops listening", () => {
    const web = createWeb(bootstrappedDoc([tabA]));
    const events: string[] = [];
    web.index.subscribe((type) => events.push(type));
    web.index.destroy();
    web.index.destroy();
    web.doc.getArray<Tab>("tabs").push([tabB]);
    web.sync(true);
    expect(web.server.released).toBe(1);
    expect(events).toEqual([]);
  });

  it("a trash answered after destroy still unlists the document", async () => {
    const web = createWeb(bootstrappedDoc([tabA, tabB]));
    const pending = web.index.trash([tabA.id]);
    web.index.destroy();
    await pending;
    expect(rawIds(web.doc)).toEqual([PLAYGROUND_ID, tabB.id]);
  });

  it("a restore answered after destroy lists nothing", async () => {
    const web = createWeb(bootstrappedDoc([tabA, tabB]));
    const { trashed } = await web.index.trash([tabA.id]);
    const pending = web.index.restore(trashed);
    web.index.destroy();
    expect(await pending).toEqual({ [tabA.id]: "restored" });
    expect(rawIds(web.doc)).toEqual([PLAYGROUND_ID, tabB.id]);
  });
});
