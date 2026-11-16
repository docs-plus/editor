import type * as Y from "yjs";

import { trackEvent } from "@/lib/analytics";
import { announceLater } from "@/lib/announce-later";
import { restoreDocuments } from "@/lib/closed-tabs-api";
import { MAX_TABS_PER_CLIENT } from "@/lib/constants";
import { findRawTabIndex, sanitizeTabs } from "@/lib/tab-api";
import type { Tab } from "@/lib/tab-entry";

/**
 * Undo and restore for closed tabs. A lazy chunk: `useSyncedTabs` and the
 * tab bar load it on the first close or the first Recently closed open, so
 * first-load JS carries only the button and the loader.
 */

/**
 * A tab to restore. `index` is its raw index before it was closed (Undo puts
 * it back there); without one it is appended (Recently closed).
 */
export type RestorableTab = { id: string; title: string; index?: number };

/** What the restore logic needs from `useSyncedTabs`. */
export interface TabList {
  tabs: () => Y.Array<unknown> | null;
  activate: (id: string) => void;
}

function quotedTitle(title: string): string {
  return `“${title || "Untitled"}”`;
}

/** `“Title”` for one tab, `N tabs` for several. */
function tabsLabel(tabs: readonly RestorableTab[]): string {
  return tabs.length === 1 ? quotedTitle(tabs[0].title) : `${tabs.length} tabs`;
}

function isListed(arr: Y.Array<unknown>, id: string): boolean {
  return findRawTabIndex(arr.toArray(), id) >= 0;
}

/** Inserts the missing tabs in one transaction, at their old index or the end. */
function insertMissing(arr: Y.Array<unknown>, entries: RestorableTab[]): void {
  // Ascending old indices put several tabs back in their old order.
  const ordered = [...entries].sort(
    (a, b) => (a.index ?? Infinity) - (b.index ?? Infinity),
  );
  const insert = () => {
    for (const entry of ordered) {
      if (isListed(arr, entry.id)) continue;
      const at =
        entry.index === undefined
          ? arr.length
          : // Playground stays at 0.
            Math.min(Math.max(entry.index, 1), arr.length);
      const tab: Tab = {
        id: entry.id,
        title: entry.title,
        createdAt: Date.now(),
      };
      arr.insert(at, [tab]);
    }
  };
  if (arr.doc) arr.doc.transact(insert);
  else insert();
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
  const arr = list.tabs();
  if (!arr || entries.length === 0) return;
  const label = tabsLabel(entries);
  const missing = entries.filter((entry) => !isListed(arr, entry.id));
  if (
    sanitizeTabs(arr.toArray()).length + missing.length >
    MAX_TABS_PER_CLIENT
  ) {
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
  const live = list.tabs();
  if (!live) return;

  const back = entries.filter((entry) => {
    const result = results[entry.id];
    return result === "restored" || result === "not_closed";
  });
  const gone = entries.filter((entry) => results[entry.id] === "gone");
  insertMissing(live, back);

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

/**
 * The pill after a close: `Closed “Title”` or `Closed N tabs`, with Undo.
 * `raw` is the shared list before the close, for the tabs' old indices.
 */
export function offerUndo(
  list: TabList,
  closed: readonly { id: string; title: string }[],
  raw: readonly unknown[],
): void {
  if (closed.length === 0) return;
  const entries: RestorableTab[] = closed.map(({ id, title }) => {
    const index = findRawTabIndex(raw, id);
    return { id, title, index: index >= 0 ? index : undefined };
  });
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
