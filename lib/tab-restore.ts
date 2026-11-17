import { trackEvent } from "@/lib/analytics";
import { announceLater } from "@/lib/announce-later";
import { MAX_TABS_PER_CLIENT } from "@/lib/constants";
import type {
  DocumentIndex,
  RestorableEntry,
} from "@/lib/platform/document-index";

/**
 * Undo and restore for closed tabs. A lazy chunk: `useSyncedTabs` and the
 * tab bar load it on the first close or the first Recently closed open, so
 * first-load JS carries only the button and the loader.
 */

/**
 * A tab to restore. `index` is its position before it was closed (Undo puts
 * it back there); without one it is appended (Recently closed).
 */
export type RestorableTab = RestorableEntry;

/** What the restore logic needs from `useSyncedTabs`. */
export interface TabList {
  /** The tab list's index; null once the hook has unmounted. */
  index: () => DocumentIndex | null;
  activate: (id: string) => void;
}

function quotedTitle(title: string): string {
  return `“${title || "Untitled"}”`;
}

/** `“Title”` for one tab, `N tabs` for several. */
function tabsLabel(tabs: readonly RestorableTab[]): string {
  return tabs.length === 1 ? quotedTitle(tabs[0].title) : `${tabs.length} tabs`;
}

/**
 * Restores closed tabs with one request. "restored" and "not_closed" (another
 * visitor restored it first, or an earlier answer was lost) both mean the
 * document is live: it is listed again unless the shared list already has it.
 */
export async function restoreTabs(
  list: TabList,
  entries: readonly RestorableTab[],
): Promise<void> {
  const index = list.index();
  if (!index || entries.length === 0) return;
  const { items } = index.snapshot();
  const label = tabsLabel(entries);
  const listed = new Set(items.map((item) => item.id));
  const missing = entries.filter((entry) => !listed.has(entry.id));
  if (items.length + missing.length > MAX_TABS_PER_CLIENT) {
    announceLater(
      `Maximum tabs reached (${MAX_TABS_PER_CLIENT}). Close a tab to restore ${label}.`,
    );
    return;
  }

  const results = await index.restore(entries);
  if (!results) {
    announceLater(`Couldn't restore ${label}. Check your connection.`);
    return;
  }
  if (list.index() !== index) return;

  const back = entries.filter((entry) => {
    const result = results[entry.id];
    return result === "restored" || result === "not_closed";
  });
  const gone = entries.filter((entry) => results[entry.id] === "gone");

  if (back[0]) list.activate(back[0].id);
  const restoredCount = entries.filter(
    (entry) => results[entry.id] === "restored",
  ).length;
  if (restoredCount > 0) {
    trackEvent("tab_restore", { restored_count: restoredCount });
  }
  if (gone.length > 0) {
    announceLater(
      gone.length === 1
        ? `${quotedTitle(gone[0].title)} can no longer be restored.`
        : `${gone.length} tabs can no longer be restored.`,
    );
  }
}

/** The pill after a close: `Closed “Title”` or `Closed N tabs`, with Undo. */
export function offerUndo(
  list: TabList,
  closed: readonly RestorableTab[],
): void {
  if (closed.length === 0) return;
  const entries = [...closed];
  announceLater(`Closed ${tabsLabel(entries)}`, {
    action: { label: "Undo", run: () => void restoreTabs(list, entries) },
  });
}

/** The Recently closed menu body (its own lazy chunk). */
export function loadRecentlyClosedMenu() {
  return import("@/components/tab-bar/recently-closed-menu").then(
    (m) => m.RecentlyClosedMenu,
  );
}
