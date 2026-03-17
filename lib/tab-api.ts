import { PLAYGROUND_ID } from "@/lib/constants";

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
