import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  vi,
} from "bun:test";

import * as hocuspocusProvider from "@hocuspocus/provider";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as Y from "yjs";

import type { UseSyncedTabsReturn } from "@/hooks/use-synced-tabs";
import * as announceLaterModule from "@/lib/announce-later";
import { MAX_TABS_PER_CLIENT, PLAYGROUND_ID } from "@/lib/constants";
import type { Tab } from "@/lib/tab-api";

/** Provider double: `onSynced()` simulates the server sync completing. */
type ProviderConfig = { document: Y.Doc; onSynced: () => void };

const providers: ProviderConfig[] = [];

mock.module("@hocuspocus/provider", () => ({
  ...hocuspocusProvider,
  HocuspocusProvider: class {
    isSynced = false;
    document: Y.Doc;
    private syncedHandlers = new Set<() => void>();
    constructor(config: { document: Y.Doc }) {
      this.document = config.document;
      providers.push(this);
    }
    onSynced = () => {
      this.isSynced = true;
      for (const handler of this.syncedHandlers) handler();
    };
    on(event: string, handler: () => void) {
      if (event === "synced") this.syncedHandlers.add(handler);
    }
    off(event: string, handler: () => void) {
      if (event === "synced") this.syncedHandlers.delete(handler);
    }
    attach() {}
    destroy() {}
  },
  // Shared socket (lib/hocuspocus.ts); the provider mock never uses it.
  HocuspocusProviderWebsocket: class {},
}));
const announceLater = vi.fn();
// mock.module is process-wide: put the real function back in afterAll.
const realAnnounceLater = announceLaterModule.announceLater;
mock.module("@/lib/announce-later", () => ({
  ...announceLaterModule,
  announceLater,
}));
afterAll(() => {
  mock.module("@/lib/announce-later", () => ({
    ...announceLaterModule,
    announceLater: realAnnounceLater,
  }));
});
// Loaded after the mocks: static imports are hoisted above `mock.module`.
const { useSyncedTabs } = await import("@/hooks/use-synced-tabs");

const TABS_KEY = "tinydocy-tabs";
const playground: Tab = {
  id: PLAYGROUND_ID,
  title: "Playground",
  createdAt: 0,
};
const probe: Tab = { id: "probe", title: "Untitled", createdAt: 1 };

let root: Root;
let consoleError: ReturnType<typeof vi.spyOn>;
const latest: { current?: UseSyncedTabsReturn } = {};

function Harness() {
  const value = useSyncedTabs();
  useEffect(() => {
    latest.current = value;
  });
  return null;
}

function hookResult(): UseSyncedTabsReturn {
  if (!latest.current) throw new Error("Harness has not rendered");
  return latest.current;
}

function currentProvider(): ProviderConfig {
  const provider = providers.at(-1);
  if (!provider) throw new Error("HocuspocusProvider was not constructed");
  return provider;
}

function storedActiveTabId(): string | undefined {
  const raw = localStorage.getItem(TABS_KEY);
  return raw
    ? (JSON.parse(raw) as { activeTabId?: string }).activeTabId
    : undefined;
}

/** Peer doc that already holds a bootstrapped tab list (server state). */
function createRemoteDoc(tabs: Tab[]): Y.Doc {
  const remote = new Y.Doc();
  remote.transact(() => {
    remote.getMap("meta").set("bootstrapped", true);
    remote.getArray<Tab>("tabs").insert(0, tabs);
  });
  return remote;
}

/** Apply everything `from` has that `to` lacks, as a remote sync message would. */
function syncFrom(from: Y.Doc, to: Y.Doc): void {
  const update = Y.encodeStateAsUpdate(from, Y.encodeStateVector(to));
  Y.applyUpdate(to, update, "remote");
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  providers.length = 0;
  latest.current = undefined;
  // Sessions outlive an unmount briefly (lib/collab-session.ts): give every
  // test its own tab-list document so none reuses another's.
  (window as Window & { __GLOBAL_TABS_DOC?: string }).__GLOBAL_TABS_DOC =
    `global-tabs-${crypto.randomUUID()}`;
  consoleError = vi.spyOn(console, "error");
  root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
});

afterEach(() => {
  act(() => root.unmount());
  // Other files in this process read the default tab-list name.
  delete (window as Window & { __GLOBAL_TABS_DOC?: string }).__GLOBAL_TABS_DOC;
  const errors = [...consoleError.mock.calls];
  consoleError.mockRestore();
  expect(errors).toEqual([]);
});

describe("useSyncedTabs bootstrap", () => {
  it("keeps the migrated active tab when seeding an empty global-tabs doc", () => {
    localStorage.setItem(
      TABS_KEY,
      JSON.stringify({ tabs: [playground, probe], activeTabId: probe.id }),
    );

    act(() => currentProvider().onSynced());

    expect(hookResult().ready).toBe(true);
    expect(hookResult().tabs.map((t) => t.id)).toEqual([
      PLAYGROUND_ID,
      probe.id,
    ]);
    expect(hookResult().activeTabId).toBe(probe.id);
    expect(storedActiveTabId()).toBe(probe.id);
  });

  it("keeps the stored active tab when the server sync lands before onSynced", () => {
    localStorage.setItem(
      TABS_KEY,
      JSON.stringify({ tabs: [], activeTabId: probe.id }),
    );
    const { document: ydoc, onSynced } = currentProvider();

    act(() => {
      syncFrom(createRemoteDoc([playground, probe]), ydoc);
      onSynced();
    });

    expect(hookResult().activeTabId).toBe(probe.id);
    expect(storedActiveTabId()).toBe(probe.id);
  });

  it("falls back to the first tab when the active tab is removed remotely", () => {
    const remote = createRemoteDoc([playground, probe]);
    localStorage.setItem(
      TABS_KEY,
      JSON.stringify({ tabs: [], activeTabId: probe.id }),
    );
    const { document: ydoc, onSynced } = currentProvider();
    act(() => {
      syncFrom(remote, ydoc);
      onSynced();
    });

    act(() => {
      remote.getArray<Tab>("tabs").delete(1, 1);
      syncFrom(remote, ydoc);
    });

    expect(hookResult().tabs.map((t) => t.id)).toEqual([PLAYGROUND_ID]);
    expect(hookResult().activeTabId).toBe(PLAYGROUND_ID);
    expect(storedActiveTabId()).toBe(PLAYGROUND_ID);
  });
});

const tabA: Tab = { id: "A", title: "A", createdAt: 2 };
const tabB: Tab = { id: "B", title: "B", createdAt: 3 };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

type FetchCall = { url: string; init?: RequestInit };

/** Stubs fetch: DELETE succeeds, POST /restore answers with `restore(ids)`. */
function stubFetch(
  restore: (ids: string[]) => Response | Promise<Response> = (ids) =>
    json({
      results: Object.fromEntries(ids.map((id) => [id, "restored"])),
    }),
): FetchCall[] {
  const calls: FetchCall[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "/api/documents/restore") {
      return restore(JSON.parse(String(init?.body)).ids);
    }
    return json({ closed: true });
  }) as typeof fetch);
  return calls;
}

function restoreCalls(calls: FetchCall[]): FetchCall[] {
  return calls.filter((call) => call.url === "/api/documents/restore");
}

function syncWith(tabs: Tab[]): { remote: Y.Doc; ydoc: Y.Doc } {
  const remote = createRemoteDoc(tabs);
  const { document: ydoc, onSynced } = currentProvider();
  act(() => {
    syncFrom(remote, ydoc);
    onSynced();
  });
  return { remote, ydoc };
}

function tabIds(): string[] {
  return hookResult().tabs.map((tab) => tab.id);
}

/** The Undo action of the last announcement. */
async function runUndo(): Promise<void> {
  const options = announceLater.mock.calls.at(-1)?.[1] as
    | import("@/lib/announce").NoticeOptions
    | undefined;
  const run = options?.action?.run;
  if (!run) throw new Error("no Undo action was announced");
  await act(async () => {
    run();
    // Let the restore request and its transaction settle.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function tabsDoc(): string {
  return (window as Window & { __GLOBAL_TABS_DOC?: string })
    .__GLOBAL_TABS_DOC as string;
}

describe("useSyncedTabs close and Undo", () => {
  beforeEach(() => {
    announceLater.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closeTab soft-deletes with the title, removes the tab and offers Undo", async () => {
    const calls = stubFetch();
    syncWith([playground, tabA, tabB]);

    await act(() => hookResult().closeTab("A"));

    expect(calls[0]?.url).toBe("/api/documents/A");
    expect(calls[0]?.init).toEqual(
      expect.objectContaining({
        method: "DELETE",
        body: JSON.stringify({ title: "A", tabsDoc: tabsDoc() }),
      }),
    );
    expect(tabIds()).toEqual([PLAYGROUND_ID, "B"]);
    expect(announceLater).toHaveBeenCalledWith("Closed “A”", {
      action: { label: "Undo", run: expect.any(Function) },
    });
  });

  it("closeTab removes duplicate entries of the closed id", async () => {
    stubFetch();
    const { ydoc } = syncWith([playground, tabA, tabB, tabA]);
    let transactions = 0;
    const count = () => transactions++;
    ydoc.on("afterTransaction", count);

    await act(() => hookResult().closeTab("A"));

    ydoc.off("afterTransaction", count);
    expect(
      ydoc
        .getArray<Tab>("tabs")
        .toArray()
        .map((t) => t.id),
    ).toEqual([PLAYGROUND_ID, "B"]);
    expect(transactions).toBe(1);
  });

  it("Undo restores the tab at its old index and makes it active", async () => {
    const calls = stubFetch();
    syncWith([playground, tabA, tabB]);
    act(() => hookResult().switchTab("B"));
    await act(() => hookResult().closeTab("A"));

    await runUndo();

    const restore = restoreCalls(calls);
    expect(restore).toHaveLength(1);
    expect(restore[0]?.init?.body).toBe('{"ids":["A"]}');
    expect(tabIds()).toEqual([PLAYGROUND_ID, "A", "B"]);
    expect(hookResult().activeTabId).toBe("A");
  });

  it("a restore racing a remote restore leaves one entry", async () => {
    let answer: (response: Response) => void = () => {};
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          answer = resolve;
        }),
    );
    const { remote, ydoc } = syncWith([playground, tabA, tabB]);
    await act(() => hookResult().closeTab("A"));
    syncFrom(ydoc, remote);

    const options = announceLater.mock.calls.at(-1)?.[1] as {
      action: { run: () => void };
    };
    act(() => options.action.run());
    // Another visitor restores A first; their entry syncs in before our answer.
    act(() => {
      remote.getArray<Tab>("tabs").insert(1, [tabA]);
      syncFrom(remote, ydoc);
    });
    await act(async () => {
      answer(json({ results: { A: "not_closed" } }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(hookResult().tabs.filter((t) => t.id === "A")).toHaveLength(1);
  });

  it("restore at the tab cap sends no request", async () => {
    const calls = stubFetch();
    const others = Array.from(
      { length: MAX_TABS_PER_CLIENT - 1 },
      (_, i): Tab => ({ id: `t${i}`, title: `T${i}`, createdAt: i + 10 }),
    );
    const { remote, ydoc } = syncWith([playground, ...others]);
    await act(() => hookResult().closeTab("t0"));
    syncFrom(ydoc, remote);
    // The list fills up again before Undo.
    act(() => {
      remote.getArray<Tab>("tabs").push([{ ...tabB }]);
      syncFrom(remote, ydoc);
    });

    await runUndo();

    expect(restoreCalls(calls)).toHaveLength(0);
    expect(announceLater).toHaveBeenLastCalledWith(
      `Maximum tabs reached (${MAX_TABS_PER_CLIENT}). Close a tab to restore “T0”.`,
    );
  });

  it("a gone restore announces it and leaves the list unchanged", async () => {
    stubFetch(() => json({ results: { A: "gone" } }));
    syncWith([playground, tabA, tabB]);
    await act(() => hookResult().closeTab("A"));

    await runUndo();

    expect(tabIds()).toEqual([PLAYGROUND_ID, "B"]);
    expect(announceLater).toHaveBeenLastCalledWith(
      "“A” can no longer be restored.",
    );
  });

  it("a failed restore asks to check the connection", async () => {
    stubFetch(() => json({}, 500));
    syncWith([playground, tabA, tabB]);
    await act(() => hookResult().closeTab("A"));

    await runUndo();

    expect(tabIds()).toEqual([PLAYGROUND_ID, "B"]);
    expect(announceLater).toHaveBeenLastCalledWith(
      "Couldn't restore “A”. Check your connection.",
    );
  });

  it("closeAllTabs offers one Undo that restores every closed tab in one request", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const calls = stubFetch(() =>
      json({ results: { A: "restored", B: "gone" } }),
    );
    syncWith([playground, tabA, tabB]);

    await act(() => hookResult().closeAllTabs());
    expect(tabIds()).toEqual([PLAYGROUND_ID]);
    expect(announceLater).toHaveBeenCalledWith("Closed 2 tabs", {
      action: { label: "Undo", run: expect.any(Function) },
    });

    await runUndo();

    const restore = restoreCalls(calls);
    expect(restore).toHaveLength(1);
    expect(JSON.parse(String(restore[0]?.init?.body))).toEqual({
      ids: ["A", "B"],
    });
    expect(tabIds()).toEqual([PLAYGROUND_ID, "A"]);
    expect(hookResult().activeTabId).toBe("A");
    expect(announceLater).toHaveBeenLastCalledWith(
      "“B” can no longer be restored.",
    );
  });

  it("restoreTabs from Recently closed appends the tab", async () => {
    stubFetch();
    syncWith([playground, tabB]);

    await act(() => hookResult().restoreTabs([{ id: "A", title: "A" }]));

    expect(tabIds()).toEqual([PLAYGROUND_ID, "B", "A"]);
    expect(hookResult().activeTabId).toBe("A");
  });
});
