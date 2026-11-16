import type { ClosedDocument } from "@/lib/security/closed-documents";
import { getGlobalTabsDoc } from "@/lib/tabs-doc-name";

/**
 * Restore and Recently closed requests. Imported only by the lazy restore
 * module and the lazy menu, so none of it is in first-load JS.
 */

// Type-only: no server code reaches the client bundle.
export type { ClosedDocument } from "@/lib/security/closed-documents";

export type RestoreResult = "restored" | "not_closed" | "gone";

/** One request for every id; null on a network error or a non-200. */
export async function restoreDocuments(
  ids: string[],
  signal?: AbortSignal,
): Promise<Record<string, RestoreResult> | null> {
  try {
    const res = await fetch("/api/documents/restore", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids }),
      signal,
    });
    if (res.status !== 200) return null;
    const body = (await res.json()) as {
      results?: Record<string, RestoreResult>;
    };
    return body.results ?? null;
  } catch {
    return null;
  }
}

export type ClosedDocumentsList = {
  documents: ClosedDocument[];
  retentionDays: number;
  disabled: boolean;
};

/** Recently closed tabs of this tab list; null on failure. */
export async function fetchClosedDocuments(
  signal?: AbortSignal,
): Promise<ClosedDocumentsList | null> {
  try {
    const res = await fetch(
      `/api/documents/closed?tabs=${encodeURIComponent(getGlobalTabsDoc())}`,
      { signal, cache: "no-store" },
    );
    if (res.status !== 200) return null;
    return (await res.json()) as ClosedDocumentsList;
  } catch {
    return null;
  }
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function formatClosedAgo(closedAt: number, nowMs: number): string {
  const elapsed = Math.max(0, nowMs - closedAt);
  if (elapsed < MINUTE_MS) return "just now";
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)} min ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)} h ago`;
  return `${Math.floor(elapsed / DAY_MS)} d ago`;
}
