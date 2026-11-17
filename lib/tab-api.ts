import { MAX_TABS_PER_CLIENT, PLAYGROUND_ID } from "@/lib/constants";
import {
  isTab,
  isValidTabEntry,
  MAX_TAB_TITLE_LENGTH,
  type Tab,
} from "@/lib/tab-entry";
import { getGlobalTabsDoc } from "@/lib/tabs-doc-name";

const TABS_KEY = "tinydocy-tabs";

/**
 * Drops the legacy tab list once it seeded the shared one. The active tab id
 * in the same key stays: it is this browser's own choice, read after the seed.
 */
export function clearMigrationStorage(): void {
  const activeTabId = loadActiveTabIdFromStorage();
  localStorage.removeItem(TABS_KEY);
  if (activeTabId) persistActiveTabId(activeTabId);
}

const PLAYGROUND_TAB: Tab = {
  id: PLAYGROUND_ID,
  title: "Playground",
  createdAt: 0,
};

export const DELETE_TIMEOUT_MS = 10_000;

export function generateId(): string {
  return crypto.randomUUID();
}

export function ensurePlaygroundTab(tabs: Tab[]): Tab[] {
  if (tabs.some((t) => t.id === PLAYGROUND_ID)) return tabs;
  return [PLAYGROUND_TAB, ...tabs];
}

/** Deduplicate by id, keeping first occurrence. Fixes duplicate key errors from sync. */
export function deduplicateTabs(tabs: Tab[]): Tab[] {
  const seen = new Set<string>();
  return tabs.filter((t) => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });
}

/** Keep `preferredId` when it names an existing tab, else fall back to the first tab. */
export function resolveActiveTabId(tabs: Tab[], preferredId: string): string {
  return tabs.some((t) => t.id === preferredId)
    ? preferredId
    : (tabs[0]?.id ?? PLAYGROUND_ID);
}

/**
 * The renderable tab list from raw shared state: drops malformed entries and
 * duplicates, trims titles, caps the count and keeps the playground first.
 */
export function sanitizeTabs(
  raw: readonly unknown[],
  maxTabs: number = MAX_TABS_PER_CLIENT,
): Tab[] {
  const valid = raw.filter(isValidTabEntry).map((tab) => ({
    id: tab.id,
    title: tab.title.slice(0, MAX_TAB_TITLE_LENGTH),
    createdAt: tab.createdAt,
  }));
  return ensurePlaygroundTab(deduplicateTabs(valid)).slice(0, maxTabs);
}

/** Index of `id` in the raw shared array, skipping malformed entries. */
export function findRawTabIndex(raw: readonly unknown[], id: string): number {
  return raw.findIndex((entry) => isTab(entry) && entry.id === id);
}

export function loadActiveTabIdFromStorage(): string {
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

export function persistActiveTabId(activeTabId: string): void {
  try {
    const raw = localStorage.getItem(TABS_KEY);
    const parsed = raw ? (JSON.parse(raw) as { tabs: Tab[] }) : { tabs: [] };
    localStorage.setItem(TABS_KEY, JSON.stringify({ ...parsed, activeTabId }));
  } catch {
    // quota exceeded
  }
}

export function getMigrationTabs(): Tab[] | null {
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

export function getDefaultBootstrap(): Tab[] {
  return [
    PLAYGROUND_TAB,
    { id: generateId(), title: "Untitled", createdAt: Date.now() },
  ];
}

/**
 * Closes a tab softly: the server keeps the document restorable for its
 * closed window. True on success, and on 404 from an older server.
 */
export async function closeDocument(
  id: string,
  title: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const res = await fetch(`/api/documents/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, tabsDoc: getGlobalTabsDoc() }),
      signal,
    });
    return res.ok || res.status === 404;
  } catch {
    return false;
  }
}
