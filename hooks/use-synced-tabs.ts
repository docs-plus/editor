"use client";

import { arrayMove } from "@dnd-kit/sortable";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import * as Y from "yjs";
import { PLAYGROUND_ID } from "@/lib/constants";
import {
  getGlobalTabsDoc,
  getHocuspocusToken,
  getHocuspocusWsUrl,
} from "@/lib/hocuspocus";

const TABS_KEY = "tinydocy-tabs";

export type Tab = {
  id: string;
  title: string;
  createdAt: number;
};

function generateId(): string {
  return crypto.randomUUID();
}

const PLAYGROUND_TAB: Tab = {
  id: PLAYGROUND_ID,
  title: "Playground",
  createdAt: 0,
};

function ensurePlaygroundTab(tabs: Tab[]): Tab[] {
  if (tabs.some((t) => t.id === PLAYGROUND_ID)) return tabs;
  return [PLAYGROUND_TAB, ...tabs];
}

/** Deduplicate by id, keeping first occurrence. Fixes duplicate key errors from sync. */
function deduplicateTabs(tabs: Tab[]): Tab[] {
  const seen = new Set<string>();
  return tabs.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

function isTab(value: unknown): value is Tab {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof (value as Tab).id === "string" &&
    "title" in value &&
    typeof (value as Tab).title === "string" &&
    "createdAt" in value &&
    typeof (value as Tab).createdAt === "number"
  );
}

function loadActiveTabIdFromStorage(): string {
  if (typeof window === "undefined") return "";
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tabs: Tab[]; activeTabId: string };
      if (parsed.activeTabId && typeof parsed.activeTabId === "string") {
        return parsed.activeTabId;
      }
    }
  } catch {
    // ignore
  }
  return "";
}

function persistActiveTabId(activeTabId: string): void {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    const parsed = raw ? (JSON.parse(raw) as { tabs: Tab[] }) : { tabs: [] };
    localStorage.setItem(TABS_KEY, JSON.stringify({ ...parsed, activeTabId }));
  } catch {
    // quota exceeded
  }
}

function getMigrationTabs(): Tab[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { tabs: unknown[] };
      if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
        const valid = parsed.tabs.filter(isTab);
        if (valid.length === parsed.tabs.length) {
          return ensurePlaygroundTab(deduplicateTabs(valid));
        }
      }
    }
  } catch {
    localStorage.removeItem(TABS_KEY);
  }
  return null;
}

function getDefaultBootstrap(): Tab[] {
  return [
    PLAYGROUND_TAB,
    { id: generateId(), title: "Untitled", createdAt: Date.now() },
  ];
}

const DELETE_TIMEOUT_MS = 10_000;

async function deleteDocument(
  id: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
      method: "DELETE",
      signal,
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}

export interface UseSyncedTabsReturn {
  ready: boolean;
  tabs: Tab[];
  activeTabId: string;
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
  const tabsArrayRef = useRef<Y.Array<Tab> | null>(null);
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closingRef = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const ydoc = new Y.Doc();
    const tabsArray = ydoc.getArray<Tab>("tabs");
    const meta = ydoc.getMap("meta");
    tabsArrayRef.current = tabsArray;

    const token = getHocuspocusToken();
    const provider = new HocuspocusProvider({
      url: getHocuspocusWsUrl(),
      name: getGlobalTabsDoc(),
      document: ydoc,
      ...(token ? { token } : {}),
      onSynced() {
        if (tabsArray.length === 0 && !meta.get("bootstrapped")) {
          ydoc.transact(() => {
            meta.set("bootstrapped", true);
            const migration = getMigrationTabs();
            const seed = migration ?? getDefaultBootstrap();
            tabsArray.insert(0, seed);
          });
          if (getMigrationTabs()) {
            localStorage.removeItem(TABS_KEY);
          }
        }

        const initialActive = loadActiveTabIdFromStorage();
        const raw = tabsArray.toArray();
        const currentTabs = ensurePlaygroundTab(deduplicateTabs(raw));
        const validActive = currentTabs.some((t) => t.id === initialActive)
          ? initialActive
          : (currentTabs[0]?.id ?? PLAYGROUND_ID);

        setTabs(currentTabs);
        setActiveTabId(validActive);
        activeTabIdRef.current = validActive;
        persistActiveTabId(validActive);
        setReady(true);
      },
    });

    const applyUpdate = () => {
      const raw = tabsArray.toArray();
      const currentTabs = ensurePlaygroundTab(deduplicateTabs(raw));
      const currentActive = activeTabIdRef.current;
      const validActive = currentTabs.some((t) => t.id === currentActive)
        ? currentActive
        : (currentTabs[0]?.id ?? PLAYGROUND_ID);

      flushSync(() => {
        setTabs(currentTabs);
        if (validActive !== currentActive) {
          setActiveTabId(validActive);
          activeTabIdRef.current = validActive;
          persistActiveTabId(validActive);
        }
      });
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

  const createTab = useCallback(() => {
    const arr = tabsArrayRef.current;
    if (!arr) return;
    const tab: Tab = {
      id: generateId(),
      title: "Untitled",
      createdAt: Date.now(),
    };
    arr.push([tab]);
    setActiveTabId(tab.id);
    persistActiveTabId(tab.id);
  }, []);

  const closeTab = useCallback(async (id: string) => {
    if (closingRef.current) return;
    const arr = tabsArrayRef.current;
    if (!arr || id === PLAYGROUND_ID) return;
    const current = arr.toArray();
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
    arr.delete(idx, 1);
    setActiveTabId(newActive);
    persistActiveTabId(newActive);
  }, []);

  const closeAllTabs = useCallback(async () => {
    if (closingRef.current) return;
    const arr = tabsArrayRef.current;
    if (!arr) return;
    const current = arr.toArray();
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

    for (const id of succeeded) {
      const idx = arr.toArray().findIndex((t) => t.id === id);
      if (idx >= 0) arr.delete(idx, 1);
    }
    const remaining = arr.toArray();
    if (remaining.length === 0) {
      const newTab: Tab = {
        id: generateId(),
        title: "Untitled",
        createdAt: Date.now(),
      };
      arr.push([newTab]);
      setActiveTabId(newTab.id);
      persistActiveTabId(newTab.id);
    } else {
      setActiveTabId(remaining[0].id);
      persistActiveTabId(remaining[0].id);
    }
  }, []);

  const reorderTab = useCallback((id: string, targetIndex: number) => {
    const arr = tabsArrayRef.current;
    if (!arr || id === PLAYGROUND_ID) return;
    const raw = arr.toArray();
    const current = ensurePlaygroundTab(deduplicateTabs(raw));
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
      const current = a.toArray();
      const idx = current.findIndex((t) => t.id === id);
      if (idx < 0) return;
      const ydoc = a.doc;
      const item = { ...current[idx], title };
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
    createTab,
    closeTab,
    closeAllTabs,
    reorderTab,
    switchTab,
    updateTabTitle,
  };
}
