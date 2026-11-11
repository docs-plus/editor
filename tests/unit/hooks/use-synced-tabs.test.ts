import {
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
import { PLAYGROUND_ID } from "@/lib/constants";
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
// Loaded after the mock: static imports are hoisted above `mock.module`.
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
