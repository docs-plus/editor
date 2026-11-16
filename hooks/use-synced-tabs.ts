"use client";

import { arrayMove } from "@dnd-kit/sortable";
import { useCallback, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";

import { trackEvent } from "@/lib/analytics";
import { announceLater } from "@/lib/announce-later";
import {
  acquireCollabSession,
  forgetLocalCopy,
  liveSessionNames,
  onSynced,
  releaseCollabSession,
} from "@/lib/collab-session";
import { MAX_TABS_PER_CLIENT, PLAYGROUND_ID } from "@/lib/constants";
import { getGlobalTabsDoc } from "@/lib/hocuspocus";
import { sweepLocalCopies } from "@/lib/offline";
import {
  clearMigrationStorage,
  closeDocument,
  DELETE_TIMEOUT_MS,
  findRawTabIndex,
  generateId,
  getDefaultBootstrap,
  getMigrationTabs,
  isTab,
  loadActiveTabIdFromStorage,
  MAX_TAB_TITLE_LENGTH,
  persistActiveTabId,
  resolveActiveTabId,
  restoreDocuments,
  sanitizeTabs,
  type Tab,
} from "@/lib/tab-api";

export type { Tab } from "@/lib/tab-api";

/**
 * A tab to restore. `index` is its raw index before it was closed (Undo puts
 * it back there); without one it is appended (Recently closed).
 */
export type RestorableTab = { id: string; title: string; index?: number };

function quotedTitle(title: string): string {
  return `“${title || "Untitled"}”`;
}

/** `“Title”` for one tab, `N tabs` for several. */
function tabsLabel(tabs: readonly RestorableTab[]): string {
  return tabs.length === 1 ? quotedTitle(tabs[0].title) : `${tabs.length} tabs`;
}

/** Deletes every raw entry whose id is in `ids`, in one transaction. */
function removeTabEntries(arr: Y.Array<unknown>, ids: ReadonlySet<string>) {
  const indices = arr
    .toArray()
    .map((t, i) => (isTab(t) && ids.has(t.id) ? i : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => b - a);
  const doDelete = () => {
    for (const idx of indices) arr.delete(idx, 1);
  };
  if (arr.doc) arr.doc.transact(doDelete);
  else doDelete();
}

export interface UseSyncedTabsReturn {
  ready: boolean;
  tabs: Tab[];
  activeTabId: string;
  canCreateTab: boolean;
  createTabLimitMessage: string;
  createTab: () => void;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;
  restoreTabs: (tabs: readonly RestorableTab[]) => Promise<void>;
  reorderTab: (id: string, targetIndex: number) => void;
  switchTab: (id: string) => void;
  updateTabTitle: (id: string, title: string) => void;
}

export function useSyncedTabs(): UseSyncedTabsReturn {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState("");
  const [ready, setReady] = useState(false);
  const activeTabIdRef = useRef("");
  const tabsArrayRef = useRef<Y.Array<unknown> | null>(null);
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const tabsDocName = getGlobalTabsDoc();
    const session = acquireCollabSession(tabsDocName);
    const ydoc = session.doc;
    const tabsArray = ydoc.getArray<unknown>("tabs");
    const meta = ydoc.getMap("meta");
    tabsArrayRef.current = tabsArray;

    const stopSyncListener = onSynced(session, () => {
      // Read before the migration below clears the shared storage key.
      const initialActive = loadActiveTabIdFromStorage();
      // Rendering from the offline copy is not a server answer: only seed
      // the shared list, and sweep stale copies, once the server synced.
      const serverSynced = session.provider.isSynced || session.hasSynced;
      if (serverSynced && tabsArray.length === 0 && !meta.get("bootstrapped")) {
        const migration = getMigrationTabs();
        ydoc.transact(() => {
          meta.set("bootstrapped", true);
          tabsArray.insert(0, migration ?? getDefaultBootstrap());
        });
        if (migration) clearMigrationStorage();
      }

      const currentTabs = sanitizeTabs(tabsArray.toArray());
      const validActive = resolveActiveTabId(currentTabs, initialActive);
      if (serverSynced) {
        sweepLocalCopies(
          new Set([tabsDocName, ...currentTabs.map((tab) => tab.id)]),
          liveSessionNames(),
        );
      }

      setTabs(currentTabs);
      setActiveTabId(validActive);
      activeTabIdRef.current = validActive;
      persistActiveTabId(validActive);
      setReady(true);
    });

    // Runs synchronously inside Yjs transactions, so plain setState is used:
    // local mutations (e.g. dnd-kit onDragEnd) are already batched by React,
    // and flushSync here re-renders mid-transaction.
    const applyUpdate = () => {
      const currentTabs = sanitizeTabs(tabsArray.toArray());
      setTabs(currentTabs);

      // The initial sync and bootstrap seed fire this before onSynced picks
      // the active tab; falling back here would persist Playground over it.
      const currentActive = activeTabIdRef.current;
      if (!currentActive) return;
      const validActive = resolveActiveTabId(currentTabs, currentActive);
      if (validActive === currentActive) return;
      activeTabIdRef.current = validActive;
      setActiveTabId(validActive);
      persistActiveTabId(validActive);
    };

    tabsArray.observe(applyUpdate);

    return () => {
      if (titleDebounceRef.current) {
        clearTimeout(titleDebounceRef.current);
        titleDebounceRef.current = null;
      }
      tabsArrayRef.current = null;
      tabsArray.unobserve(applyUpdate);
      stopSyncListener();
      releaseCollabSession(tabsDocName);
      setReady(false);
    };
  }, []);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  const createTabLimitMessage = `Maximum tabs reached (${MAX_TABS_PER_CLIENT})`;

  const createTab = useCallback(() => {
    const arr = tabsArrayRef.current;
    if (!arr) return;
    const current = sanitizeTabs(arr.toArray());
    if (current.length >= MAX_TABS_PER_CLIENT) return;
    const tab: Tab = {
      id: generateId(),
      title: "Untitled",
      createdAt: Date.now(),
    };
    arr.push([tab]);
    trackEvent("tab_create", { tab_count: current.length + 1 });
    setActiveTabId(tab.id);
    persistActiveTabId(tab.id);
  }, []);

  const activate = useCallback((id: string) => {
    activeTabIdRef.current = id;
    setActiveTabId(id);
    persistActiveTabId(id);
  }, []);

  const restoreTabs = useCallback(
    async (entries: readonly RestorableTab[]) => {
      const arr = tabsArrayRef.current;
      if (!arr || entries.length === 0) return;
      const label = tabsLabel(entries);
      const missing = entries.filter(
        (entry) => findRawTabIndex(arr.toArray(), entry.id) < 0,
      );
      const openCount = sanitizeTabs(arr.toArray()).length;
      if (openCount + missing.length > MAX_TABS_PER_CLIENT) {
        announceLater(
          `Maximum tabs reached (${MAX_TABS_PER_CLIENT}). Close a tab to restore ${label}.`,
        );
        return;
      }

      const results = await restoreDocuments(entries.map((entry) => entry.id));
      if (!results) {
        announceLater(`Couldn't restore ${label}. Check your connection.`);
        return;
      }
      const live = tabsArrayRef.current;
      if (!live) return;

      const restored = entries.filter(
        (entry) => results[entry.id] === "restored",
      );
      const gone = entries.filter((entry) => results[entry.id] === "gone");
      // Ascending old indices put several tabs back in their old order.
      const ordered = [...restored].sort(
        (a, b) => (a.index ?? Infinity) - (b.index ?? Infinity),
      );
      const insert = () => {
        for (const entry of ordered) {
          // "restored" but already listed: another visitor's entry synced in.
          if (findRawTabIndex(live.toArray(), entry.id) >= 0) continue;
          const at =
            entry.index === undefined
              ? live.length
              : Math.min(Math.max(entry.index, 1), live.length);
          const tab: Tab = {
            id: entry.id,
            title: entry.title,
            createdAt: Date.now(),
          };
          live.insert(at, [tab]);
        }
      };
      if (live.doc) live.doc.transact(insert);
      else insert();

      // "not_closed": another visitor restored it first; it arrives through
      // the shared list.
      const back = entries.find(
        (entry) =>
          results[entry.id] !== "gone" &&
          findRawTabIndex(live.toArray(), entry.id) >= 0,
      );
      if (back) activate(back.id);
      if (restored.length > 0) {
        trackEvent("tab_restore", { restored_count: restored.length });
      }
      if (gone.length > 0) {
        announceLater(
          gone.length === 1
            ? `${quotedTitle(gone[0].title)} can no longer be restored.`
            : `${gone.length} tabs can no longer be restored.`,
        );
      }
    },
    [activate],
  );

  const offerUndo = useCallback(
    (closed: RestorableTab[]) => {
      if (closed.length === 0) return;
      announceLater(`Closed ${tabsLabel(closed)}`, {
        action: { label: "Undo", run: () => void restoreTabs(closed) },
      });
    },
    [restoreTabs],
  );

  const closeTab = useCallback(
    async (id: string) => {
      if (closingRef.current) return;
      const arr = tabsArrayRef.current;
      if (!arr || id === PLAYGROUND_ID) return;
      const current = sanitizeTabs(arr.toArray());
      if (current.length <= 1) return;
      const idx = current.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const { title } = current[idx];

      closingRef.current = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
      const ok = await closeDocument(id, title, controller.signal).finally(
        () => {
          clearTimeout(timeout);
          closingRef.current = false;
        },
      );
      if (!ok) {
        alert("Could not close tab");
        return;
      }

      const newActive =
        activeTabIdRef.current === id
          ? (current[idx === current.length - 1 ? idx - 1 : idx + 1]?.id ??
            current[0]?.id ??
            PLAYGROUND_ID)
          : activeTabIdRef.current;
      // Re-resolve: the shared array may have changed while DELETE was in flight.
      const rawIdx = findRawTabIndex(arr.toArray(), id);
      removeTabEntries(arr, new Set([id]));
      forgetLocalCopy(id);
      activate(newActive);
      offerUndo([{ id, title, index: rawIdx >= 0 ? rawIdx : undefined }]);
    },
    [activate, offerUndo],
  );

  const closeAllTabs = useCallback(async () => {
    if (closingRef.current) return;
    const arr = tabsArrayRef.current;
    if (!arr) return;
    const current = sanitizeTabs(arr.toArray());
    const userTabs = current.filter((t) => t.id !== PLAYGROUND_ID);
    if (userTabs.length === 0) return;

    const confirmed = window.confirm(
      `Close all ${userTabs.length} tab${userTabs.length === 1 ? "" : "s"}?`,
    );
    if (!confirmed) return;

    closingRef.current = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
    const results = await Promise.allSettled(
      userTabs.map((t) =>
        closeDocument(t.id, t.title, controller.signal).then((ok) => ({
          id: t.id,
          ok,
        })),
      ),
    ).finally(() => {
      clearTimeout(timeout);
      closingRef.current = false;
    });

    const succeeded = results
      .filter(
        (r): r is PromiseFulfilledResult<{ id: string; ok: boolean }> =>
          r.status === "fulfilled" && r.value.ok,
      )
      .map((r) => r.value.id);
    const failedIds = results
      .filter(
        (r): r is PromiseFulfilledResult<{ id: string; ok: boolean }> =>
          r.status === "fulfilled" && !r.value.ok,
      )
      .map((r) => r.value.id);
    const hasRejected = results.some((r) => r.status === "rejected");

    if (hasRejected || failedIds.length > 0) {
      const titles = hasRejected
        ? current.map((t) => t.title || "Untitled").join(", ")
        : current
            .filter((t) => failedIds.includes(t.id))
            .map((t) => t.title || "Untitled")
            .join(", ");
      alert(`Could not close: ${titles}`);
    }

    const succeededSet = new Set(succeeded);
    for (const id of succeeded) forgetLocalCopy(id);
    const raw = arr.toArray();
    const closed: RestorableTab[] = userTabs
      .filter((t) => succeededSet.has(t.id))
      .map((t) => {
        const index = findRawTabIndex(raw, t.id);
        return {
          id: t.id,
          title: t.title,
          index: index >= 0 ? index : undefined,
        };
      });
    removeTabEntries(arr, succeededSet);
    if (succeeded.length > 0) {
      trackEvent("tab_close_all", { closed_count: succeeded.length });
    }

    const remaining = sanitizeTabs(arr.toArray());
    const nextId =
      remaining[0]?.id ??
      (() => {
        const newTab: Tab = {
          id: generateId(),
          title: "Untitled",
          createdAt: Date.now(),
        };
        arr.push([newTab]);
        return newTab.id;
      })();
    activate(nextId);
    offerUndo(closed);
  }, [activate, offerUndo]);

  const reorderTab = useCallback((id: string, targetIndex: number) => {
    const arr = tabsArrayRef.current;
    if (!arr || id === PLAYGROUND_ID) return;
    // Rewrites the whole array from the sanitized list, which also drops any
    // malformed entries another client wrote.
    const current = sanitizeTabs(arr.toArray());
    const oldIndex = current.findIndex((t) => t.id === id);
    if (oldIndex < 0) return;
    if (oldIndex === targetIndex) return;
    const reordered = arrayMove(current, oldIndex, targetIndex);
    const ydoc = arr.doc;
    if (ydoc) {
      ydoc.transact(() => {
        arr.delete(0, arr.length);
        arr.insert(0, reordered);
      });
    } else {
      arr.delete(0, arr.length);
      arr.insert(0, reordered);
    }
  }, []);

  const switchTab = useCallback((id: string) => {
    setActiveTabId(id);
    persistActiveTabId(id);
  }, []);

  const updateTabTitle = useCallback((id: string, title: string) => {
    const arr = tabsArrayRef.current;
    if (!arr) return;
    if (titleDebounceRef.current) {
      clearTimeout(titleDebounceRef.current);
    }
    titleDebounceRef.current = setTimeout(() => {
      titleDebounceRef.current = null;
      const a = tabsArrayRef.current;
      if (!a) return;
      const idx = findRawTabIndex(a.toArray(), id);
      if (idx < 0) return;
      const existing = a.get(idx);
      if (!isTab(existing)) return;
      const ydoc = a.doc;
      const item: Tab = {
        ...existing,
        title: title.slice(0, MAX_TAB_TITLE_LENGTH),
      };
      if (ydoc) {
        ydoc.transact(() => {
          a.delete(idx, 1);
          a.insert(idx, [item]);
        });
      } else {
        a.delete(idx, 1);
        a.insert(idx, [item]);
      }
    }, 300);
  }, []);

  return {
    ready,
    tabs,
    activeTabId,
    canCreateTab: tabs.length < MAX_TABS_PER_CLIENT,
    createTabLimitMessage,
    createTab,
    closeTab,
    closeAllTabs,
    restoreTabs,
    reorderTab,
    switchTab,
    updateTabTitle,
  };
}
