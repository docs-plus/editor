import type { DocStoreBackend, StoredDoc } from "@/lib/offline";

/**
 * The pre-N bundle's `LocalDocStore` key, `load` and `prune` logic, copied
 * verbatim from `main` with its constants hardcoded, so tests can prove the
 * current store's keys stay invisible to tabs still running the old bundle.
 * Never import these values from the live module.
 */
const OFFLINE_CACHE_EPOCH = 1;
const OFFLINE_DOC_MAX_AGE_DAYS = 14;
const OFFLINE_MAX_DOCS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function legacyBundleStoreKey(serverHost: string, name: string): string {
  return `${OFFLINE_CACHE_EPOCH}:${serverHost}:${name}`;
}

function isCurrent(doc: StoredDoc, now: number): boolean {
  return (
    doc.key.startsWith(`${OFFLINE_CACHE_EPOCH}:`) &&
    now - doc.updatedAt < OFFLINE_DOC_MAX_AGE_DAYS * DAY_MS
  );
}

export class LegacyLocalDocStore {
  constructor(
    private readonly backend: DocStoreBackend,
    private readonly serverHost: string,
    private readonly now: () => number = Date.now,
  ) {}

  async load(name: string): Promise<Uint8Array | null> {
    const key = legacyBundleStoreKey(this.serverHost, name);
    const stored = await this.backend.get(key);
    if (!stored) return null;
    if (!isCurrent(stored, this.now())) {
      await this.backend.delete(key);
      return null;
    }
    return stored.update;
  }

  async save(name: string, update: Uint8Array): Promise<void> {
    await this.backend.put({
      key: legacyBundleStoreKey(this.serverHost, name),
      name,
      update,
      updatedAt: this.now(),
    });
  }

  async prune({
    keep,
    isWanted = () => true,
    maxDocs = OFFLINE_MAX_DOCS,
  }: {
    keep: ReadonlySet<string>;
    isWanted?: (name: string) => boolean;
    maxDocs?: number;
  }): Promise<string[]> {
    const now = this.now();
    const prefix = `${OFFLINE_CACHE_EPOCH}:${this.serverHost}:`;
    const docs = await this.backend.all();
    const removed: string[] = [];
    const survivors: StoredDoc[] = [];
    for (const doc of docs) {
      const ours = doc.key.startsWith(prefix);
      const stale = !isCurrent(doc, now);
      if (keep.has(doc.name) && ours && !stale) {
        survivors.push(doc);
        continue;
      }
      if (!ours && !stale) continue; // another server's live copy
      if (stale || !isWanted(doc.name)) {
        await this.backend.delete(doc.key);
        removed.push(doc.name);
      } else {
        survivors.push(doc);
      }
    }
    const evictable = survivors
      .filter((doc) => !keep.has(doc.name))
      .sort((a, b) => a.updatedAt - b.updatedAt);
    let excess = survivors.length - maxDocs;
    for (const doc of evictable) {
      if (excess <= 0) break;
      await this.backend.delete(doc.key);
      removed.push(doc.name);
      excess--;
    }
    return removed;
  }
}
