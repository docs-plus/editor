import type * as Y from "yjs";

import {
  acquireCollabSession,
  forgetLocalCopy,
  liveSessionNames,
  onSynced,
  releaseCollabSession,
} from "@/lib/collab-session";
import { PLAYGROUND_ID } from "@/lib/constants";
import { sweepLocalCopies } from "@/lib/offline";
import type {
  DocumentEntry,
  DocumentIndex,
  DocumentIndexListener,
  DocumentIndexSnapshot,
  RestorableEntry,
  RestoreResult,
  TrashResult,
} from "@/lib/platform/document-index";
import {
  clearMigrationStorage,
  closeDocument,
  DELETE_TIMEOUT_MS,
  findRawTabIndex,
  generateId,
  getDefaultBootstrap,
  getMigrationTabs,
  sanitizeTabs,
} from "@/lib/tab-api";
import { isTab, MAX_TAB_TITLE_LENGTH, type Tab } from "@/lib/tab-entry";
import { getGlobalTabsDoc } from "@/lib/tabs-doc-name";

/**
 * What `GlobalTabsIndex` needs from the collaboration layer and the server.
 * `createGlobalTabsIndex()` wires the real ones; tests pass plain Y.Docs.
 */
export interface GlobalTabsSource {
  /** The shared tab list's Y.Doc: `tabs` (Y.Array) and `meta` (Y.Map). */
  doc: Y.Doc;
  /**
   * Calls `handler` when the doc can be rendered (the device copy or the
   * server) and again on every server sync; `serverSynced` says whether
   * the server has answered. Returns the stop function.
   */
  onSynced(handler: (serverSynced: boolean) => void): () => void;
  /** Ends the source; called once by `destroy()`. */
  release(): void;
  /** Soft-closes a document on the server; false on failure. */
  closeDocument(
    id: string,
    title: string,
    signal: AbortSignal,
  ): Promise<boolean>;
  /** Reopens closed documents; null on failure. */
  restoreDocuments(
    ids: string[],
  ): Promise<Record<string, RestoreResult> | null>;
  /** A document left the list: drop what the device keeps of it. */
  forgetDocument(id: string): void;
  /** After a server sync: drop device copies of documents no longer listed. */
  keepOnly(ids: ReadonlySet<string>): void;
}

/** Deletes every raw entry whose id is in `ids`. Call inside a transaction. */
function removeEntries(arr: Y.Array<unknown>, ids: ReadonlySet<string>): void {
  const indices = arr
    .toArray()
    .map((t, i) => (isTab(t) && ids.has(t.id) ? i : -1))
    .filter((i) => i >= 0)
    .sort((a, b) => b - a);
  for (const idx of indices) arr.delete(idx, 1);
}

/**
 * The web sandbox's `DocumentIndex`: the `tabs` array of the shared
 * `global-tabs` Y.Doc, which every visitor can write.
 *
 * - Reads go through `sanitizeTabs` (malformed, duplicate and over-cap
 *   entries are dropped; Playground is always first). Hocus repairs the
 *   stored array (`lib/security/tabs-doc-repair.ts`).
 * - Playground cannot be trashed or moved, and nothing moves above it.
 * - The first server sync of an empty, never-bootstrapped list seeds it
 *   from the legacy local tab list, or with Playground and one new tab.
 * - Trash and restore positions are raw indices into the shared array.
 */
export class GlobalTabsIndex implements DocumentIndex {
  private readonly tabs: Y.Array<unknown>;
  private readonly meta: Y.Map<unknown>;
  private readonly listeners = new Set<DocumentIndexListener>();
  private readonly stopSync: () => void;
  private current: DocumentIndexSnapshot = { rev: 0, ready: false, items: [] };
  private destroyed = false;

  constructor(private readonly source: GlobalTabsSource) {
    this.tabs = source.doc.getArray<unknown>("tabs");
    this.meta = source.doc.getMap("meta");
    this.tabs.observe(this.onChange);
    this.stopSync = source.onSynced(this.onLoad);
  }

  snapshot(): DocumentIndexSnapshot {
    return this.current;
  }

  subscribe(listener: DocumentIndexListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  create(init?: { title?: string }): DocumentEntry | null {
    if (!this.writable()) return null;
    const tab: Tab = {
      id: generateId(),
      title: (init?.title ?? "Untitled").slice(0, MAX_TAB_TITLE_LENGTH),
      createdAt: Date.now(),
    };
    this.tabs.push([tab]);
    return tab;
  }

  rename(id: string, title: string): void {
    if (!this.writable()) return;
    const idx = findRawTabIndex(this.tabs.toArray(), id);
    if (idx < 0) return;
    const existing = this.tabs.get(idx);
    if (!isTab(existing)) return;
    const item: Tab = {
      ...existing,
      title: title.slice(0, MAX_TAB_TITLE_LENGTH),
    };
    this.transact(() => {
      this.tabs.delete(idx, 1);
      this.tabs.insert(idx, [item]);
    });
  }

  move(id: string, toIndex: number): void {
    if (!this.writable() || id === PLAYGROUND_ID) return;
    // Rewrites the whole array from the sanitized list, which also drops any
    // malformed entries another client wrote.
    const items = sanitizeTabs(this.tabs.toArray());
    const from = items.findIndex((t) => t.id === id);
    const to = Math.min(Math.max(toIndex, 1), items.length - 1);
    if (from < 0 || from === to) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    this.transact(() => {
      this.tabs.delete(0, this.tabs.length);
      this.tabs.insert(0, items);
    });
  }

  async trash(ids: readonly string[]): Promise<TrashResult> {
    const items = this.current.items;
    const targets = ids
      .filter((id) => id !== PLAYGROUND_ID)
      .map((id) => items.find((t) => t.id === id))
      .filter((t): t is DocumentEntry => t !== undefined);
    const unknown = ids.filter((id) => !targets.some((t) => t.id === id));
    if (!this.writable() || targets.length === 0) {
      return { trashed: [], failed: [...ids] };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DELETE_TIMEOUT_MS);
    const results = await Promise.allSettled(
      targets.map((t) =>
        this.source.closeDocument(t.id, t.title, controller.signal),
      ),
    ).finally(() => clearTimeout(timeout));
    const ok = targets.filter(
      (_, i) => results[i].status === "fulfilled" && results[i].value,
    );
    const failed = [
      ...targets.filter((t) => !ok.includes(t)).map((t) => t.id),
      ...unknown,
    ];
    if (ok.length === 0) return { trashed: [], failed };

    // Unlisted even after destroy(): the server has closed them already.
    // Re-read: the shared array may have changed while DELETE was in flight.
    const raw = this.tabs.toArray();
    const trashed = ok.map(({ id, title }): RestorableEntry => {
      const index = findRawTabIndex(raw, id);
      return { id, title, index: index >= 0 ? index : undefined };
    });
    this.transact(() => removeEntries(this.tabs, new Set(ok.map((t) => t.id))));
    for (const { id } of ok) this.source.forgetDocument(id);
    return { trashed, failed };
  }

  async restore(
    entries: readonly RestorableEntry[],
  ): Promise<Record<string, RestoreResult> | null> {
    if (!this.writable() || entries.length === 0) return null;
    const results = await this.source.restoreDocuments(
      entries.map((entry) => entry.id),
    );
    if (!results || this.destroyed) return results;
    const back = entries.filter((entry) => {
      const result = results[entry.id];
      return result === "restored" || result === "not_closed";
    });
    this.insertMissing(back);
    return results;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.tabs.unobserve(this.onChange);
    this.stopSync();
    this.listeners.clear();
    this.source.release();
  }

  /** Inserts the unlisted entries in one transaction, at their old index or the end. */
  private insertMissing(entries: readonly RestorableEntry[]): void {
    // Ascending old indices put several tabs back in their old order.
    const ordered = [...entries].sort(
      (a, b) => (a.index ?? Infinity) - (b.index ?? Infinity),
    );
    this.transact(() => {
      for (const entry of ordered) {
        if (findRawTabIndex(this.tabs.toArray(), entry.id) >= 0) continue;
        const at =
          entry.index === undefined
            ? this.tabs.length
            : // Playground stays at 0.
              Math.min(Math.max(entry.index, 1), this.tabs.length);
        const tab: Tab = {
          id: entry.id,
          title: entry.title,
          createdAt: Date.now(),
        };
        this.tabs.insert(at, [tab]);
      }
    });
  }

  private readonly onLoad = (serverSynced: boolean): void => {
    // Rendering from the device copy is not a server answer: only seed the
    // shared list, and sweep stale copies, once the server synced.
    if (
      serverSynced &&
      this.tabs.length === 0 &&
      !this.meta.get("bootstrapped")
    ) {
      const migration = getMigrationTabs();
      this.transact(() => {
        this.meta.set("bootstrapped", true);
        this.tabs.insert(0, migration ?? getDefaultBootstrap());
      });
      if (migration) clearMigrationStorage();
    }
    this.publish("load");
    if (serverSynced) {
      const ids = this.current.items.map((tab) => tab.id);
      this.source.keepOnly(new Set(ids));
    }
  };

  // Runs synchronously inside Yjs transactions.
  private readonly onChange = (): void => {
    // Changes before the first load (the device copy, the initial sync, the
    // seed) are part of that load.
    if (this.current.ready) this.publish("change");
  };

  private publish(type: "load" | "change"): void {
    this.current = {
      rev: this.current.rev + 1,
      ready: true,
      items: sanitizeTabs(this.tabs.toArray()),
    };
    const snapshot = this.current;
    for (const listener of [...this.listeners]) listener(type, snapshot);
  }

  private writable(): boolean {
    return this.current.ready && !this.destroyed;
  }

  private transact(fn: () => void): void {
    this.source.doc.transact(fn);
  }
}

/** The sandbox index over the shared `global-tabs` collaboration session. */
export function createGlobalTabsIndex(): GlobalTabsIndex {
  const name = getGlobalTabsDoc();
  const session = acquireCollabSession(name);
  // Restore requests stay out of first-load JS.
  const loadRestoreApi = () => import("@/lib/closed-tabs-api");
  return new GlobalTabsIndex({
    doc: session.doc,
    onSynced: (handler) =>
      onSynced(session, () =>
        handler(session.provider.isSynced || session.hasSynced),
      ),
    release: () => releaseCollabSession(name),
    closeDocument: (id, title, signal) => {
      // Undo follows a close: fetch the restore code meanwhile.
      void loadRestoreApi();
      return closeDocument(id, title, signal);
    },
    restoreDocuments: async (ids) =>
      (await loadRestoreApi()).restoreDocuments(ids),
    forgetDocument: forgetLocalCopy,
    keepOnly: (ids) =>
      sweepLocalCopies(new Set([name, ...ids]), liveSessionNames()),
  });
}
