import { MAX_TABS_PER_CLIENT, PLAYGROUND_ID } from "@/lib/constants";
import { isValidUserDocumentId } from "@/lib/security/doc-id-validator";

export type Tab = {
  id: string;
  title: string;
  createdAt: number;
};

const TABS_KEY = "tinydocy-tabs";

export function clearMigrationStorage(): void {
  localStorage.removeItem(TABS_KEY);
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

export function isTab(value: unknown): value is Tab {
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

export const MAX_TAB_TITLE_LENGTH = 200;

/**
 * True for an entry any client may render: a well-formed tab whose id is the
 * playground or a valid user document id. The tab list is shared and writable
 * by every anonymous visitor, so nothing in it is trusted.
 */
export function isValidTabEntry(value: unknown): value is Tab {
  return (
    isTab(value) &&
    Number.isFinite(value.createdAt) &&
    (value.id === PLAYGROUND_ID || isValidUserDocumentId(value.id))
  );
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

export async function deleteDocument(
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
