"use client";

import { arrayMove } from "@dnd-kit/sortable";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";

import { trackEvent } from "@/lib/analytics";
import { MAX_TABS_PER_CLIENT, PLAYGROUND_ID } from "@/lib/constants";
import {
  getGlobalTabsDoc,
  getHocuspocusToken,
  getHocuspocusWsUrl,
} from "@/lib/hocuspocus";
import {
  clearMigrationStorage,
  DELETE_TIMEOUT_MS,
  deleteDocument,
  findRawTabIndex,
  generateId,
  getDefaultBootstrap,
  getMigrationTabs,
  isTab,
  loadActiveTabIdFromStorage,
  MAX_TAB_TITLE_LENGTH,
  persistActiveTabId,
  resolveActiveTabId,
  sanitizeTabs,
  type Tab,
} from "@/lib/tab-api";

export type { Tab } from "@/lib/tab-api";

export interface UseSyncedTabsReturn {
  ready: boolean;
  tabs: Tab[];
  activeTabId: string;
  canCreateTab: boolean;
  createTabLimitMessage: string;
  createTab: () => void;
  closeTab: (id: string) => void;
  closeAllTabs: () => void;
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

    const ydoc = new Y.Doc();
    const tabsArray = ydoc.getArray<unknown>("tabs");
    const meta = ydoc.getMap("meta");
    tabsArrayRef.current = tabsArray;

    const token = getHocuspocusToken();
    const provider = new HocuspocusProvider({
      url: getHocuspocusWsUrl(),
      name: getGlobalTabsDoc(),
      document: ydoc,
      ...(token ? { token } : {}),
      onSynced() {
        // Read before the migration below clears the shared storage key.
        const initialActive = loadActiveTabIdFromStorage();
        if (tabsArray.length === 0 && !meta.get("bootstrapped")) {
          const migration = getMigrationTabs();
          ydoc.transact(() => {
            meta.set("bootstrapped", true);
            tabsArray.insert(0, migration ?? getDefaultBootstrap());
          });
          if (migration) clearMigrationStorage();
        }

        const currentTabs = sanitizeTabs(tabsArray.toArray());
        const validActive = resolveActiveTabId(currentTabs, initialActive);

        setTabs(currentTabs);
        setActiveTabId(validActive);
        activeTabIdRef.current = validActive;
        persistActiveTabId(validActive);
        setReady(true);
      },
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
      provider.destroy();
      ydoc.destroy();
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

  const closeTab = useCallback(async (id: string) => {
    if (closingRef.current) return;
    const arr = tabsArrayRef.current;
    if (!arr || id === PLAYGROUND_ID) return;
    const current = sanitizeTabs(arr.toArray());
    if (current.length <= 1) return;
    const idx = current.findIndex((t) => t.id === id);
    if (idx < 0) return;

    closingRef.current = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
    const ok = await deleteDocument(id, controller.signal).finally(() => {
      clearTimeout(timeout);
      closingRef.current = false;
    });
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
    if (rawIdx >= 0) arr.delete(rawIdx, 1);
    setActiveTabId(newActive);
    persistActiveTabId(newActive);
  }, []);

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
        deleteDocument(t.id, controller.signal).then((ok) => ({
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
    const ydoc = arr.doc;
    const indices = arr
      .toArray()
      .map((t, i) => (isTab(t) && succeededSet.has(t.id) ? i : -1))
      .filter((i) => i >= 0)
      .sort((a, b) => b - a);

    const doDelete = () => {
      for (const idx of indices) arr.delete(idx, 1);
    };
    if (ydoc) {
      ydoc.transact(doDelete);
    } else {
      doDelete();
    }
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
    setActiveTabId(nextId);
    persistActiveTabId(nextId);
  }, []);

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
    reorderTab,
    switchTab,
    updateTabTitle,
  };
}
