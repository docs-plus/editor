"use client";

import { useCallback, useEffect, useState } from "react";
import { migrateLegacyDocument } from "@/hooks/use-document-storage";
import { deleteDocumentDatabase } from "@/hooks/use-yjs-document";

const TABS_KEY = "tinydocy-tabs";

export type Tab = {
  id: string;
  title: string;
  createdAt: number;
};

type TabsState = { tabs: Tab[]; activeTabId: string };

function generateId(): string {
  return crypto.randomUUID();
}

function loadTabsFromStorage(): TabsState | null {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TabsState;
      if (parsed.tabs.length > 0) return parsed;
    }
  } catch {
    localStorage.removeItem(TABS_KEY);
  }
  return null;
}

function getInitialState(): TabsState {
  if (typeof window === "undefined") return { tabs: [], activeTabId: "" };
  const stored = loadTabsFromStorage();
  if (stored) return stored;

  const id = generateId();
  migrateLegacyDocument(id);
  return {
    tabs: [{ id, title: "Untitled", createdAt: Date.now() }],
    activeTabId: id,
  };
}

function persistTabs(tabs: Tab[], activeTabId: string) {
  try {
    localStorage.setItem(TABS_KEY, JSON.stringify({ tabs, activeTabId }));
  } catch {
    // quota exceeded
  }
}

export function useTabs() {
  const [state, setState] = useState<TabsState>({ tabs: [], activeTabId: "" });
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const initial = getInitialState();
    setState(initial);
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) persistTabs(state.tabs, state.activeTabId);
  }, [state, ready]);

  const createTab = useCallback(() => {
    const tab: Tab = {
      id: generateId(),
      title: "Untitled",
      createdAt: Date.now(),
    };
    setState((prev) => ({ tabs: [...prev.tabs, tab], activeTabId: tab.id }));
  }, []);

  const closeTab = useCallback((id: string) => {
    setState((prev) => {
      if (prev.tabs.length <= 1) return prev;

      const idx = prev.tabs.findIndex((t) => t.id === id);
      const next = prev.tabs.filter((t) => t.id !== id);
      const newActive =
        prev.activeTabId === id
          ? next[Math.min(idx, next.length - 1)].id
          : prev.activeTabId;

      deleteDocumentDatabase(id);
      return { tabs: next, activeTabId: newActive };
    });
  }, []);

  const switchTab = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeTabId: id }));
  }, []);

  const updateTabTitle = useCallback((id: string, title: string) => {
    setState((prev) => ({
      ...prev,
      tabs: prev.tabs.map((t) => (t.id === id ? { ...t, title } : t)),
    }));
  }, []);

  return {
    ready,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    createTab,
    closeTab,
    switchTab,
    updateTabTitle,
  };
}
