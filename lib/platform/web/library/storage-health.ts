/**
 * The browser's storage guarantees, read honestly (web library §2.6, §2.7).
 * Pure functions over a `StorageManager`-shaped object, so the storage card
 * (W6) and tests share them; nothing here runs on its own.
 *
 * - `persist()` is never called on page load. Chromium and Safari decide
 *   silently, so they are asked after the first library document and after
 *   `appinstalled`. Firefox shows a prompt, so it, and any engine we don't
 *   recognise, is asked only from a click on **Keep my documents**.
 * - Choosing by engine is the only user-agent sniffing, and it picks copy
 *   and timing, never behaviour.
 * - "Storage almost full" is not computed from Chromium's `estimate()`:
 *   Chrome reports `quota` as usage + 10 GiB. The warning shows only when
 *   the reported quota is under 10 GiB and less than 100 MB is left.
 */

export type BrowserEngine = "chromium" | "firefox" | "webkit" | "unknown";

/** What led to a `persist()` request. */
export type PersistTrigger = "first_document" | "app_installed" | "click";

/** The part of `navigator.storage` the library reads. */
export type StorageLike = Partial<
  Pick<StorageManager, "persist" | "persisted" | "estimate">
>;

/** Less than this left (and a believable quota) is "Storage almost full". */
export const STORAGE_LOW_BYTES = 100 * 1024 * 1024;

/** Chromium reports quota as usage + 10 GiB; at or above this it says nothing. */
export const STATIC_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

/** `estimate()` runs again after this much growth... */
export const ESTIMATE_GROWTH_BYTES = 5 * 1024 * 1024;

/** ...and at most this often. */
export const ESTIMATE_MIN_INTERVAL_MS = 60_000;

export function detectEngine(userAgent: string): BrowserEngine {
  if (/Firefox\//.test(userAgent)) return "firefox";
  // Chromium browsers also say "Safari"; check them first.
  if (/(Chrome|Chromium|CriOS|Edg)\//.test(userAgent)) return "chromium";
  if (/AppleWebKit\//.test(userAgent) && /Safari\//.test(userAgent)) {
    return "webkit";
  }
  return "unknown";
}

/** Whether `trigger` may call `persist()` on `engine` (§2.7 table). */
export function mayRequestPersist(
  engine: BrowserEngine,
  trigger: PersistTrigger,
): boolean {
  if (trigger === "click") return true;
  return engine === "chromium" || engine === "webkit";
}

/**
 * Calls `persist()` when the §2.7 rules allow it. Resolves with the answer,
 * or null when it wasn't asked or the API is missing or throws.
 */
export async function requestPersistence(
  storage: StorageLike | undefined,
  engine: BrowserEngine,
  trigger: PersistTrigger,
): Promise<boolean | null> {
  if (!mayRequestPersist(engine, trigger) || !storage?.persist) return null;
  try {
    return await storage.persist();
  } catch {
    return null;
  }
}

/** `persisted()`, read at every start; false when missing or failing. */
export async function readPersisted(
  storage: StorageLike | undefined,
): Promise<boolean> {
  try {
    return (await storage?.persisted?.()) === true;
  } catch {
    return false;
  }
}

export type StorageEstimateResult = { usage: number; quota: number };

/** The §2.6 rule for the "Storage almost full" banner. */
export function isStorageAlmostFull({
  usage,
  quota,
}: StorageEstimateResult): boolean {
  return quota < STATIC_QUOTA_BYTES && quota - usage < STORAGE_LOW_BYTES;
}

/**
 * Runs `estimate()` at startup, then again only after 5 MB of growth and at
 * most once a minute (§2.6). `estimate()` throws `TypeError` where storage
 * is disabled; that reads as "unknown" (null), never as an error.
 */
export class StorageEstimator {
  private last: StorageEstimateResult | null = null;
  private lastAt: number | null = null;
  private grown = 0;

  constructor(
    private readonly storage: StorageLike | undefined,
    private readonly now: () => number = Date.now,
  ) {}

  /** Records bytes written since the last estimate. */
  noteGrowth(bytes: number): void {
    this.grown += Math.max(0, bytes);
  }

  /** The latest estimate, refreshed when the rules above allow. */
  async estimate(): Promise<StorageEstimateResult | null> {
    const due =
      this.lastAt === null ||
      (this.grown >= ESTIMATE_GROWTH_BYTES &&
        this.now() - this.lastAt >= ESTIMATE_MIN_INTERVAL_MS);
    if (!due) return this.last;
    this.lastAt = this.now();
    this.grown = 0;
    try {
      const result = await this.storage?.estimate?.();
      this.last =
        result &&
        typeof result.usage === "number" &&
        typeof result.quota === "number"
          ? { usage: result.usage, quota: result.quota }
          : null;
    } catch {
      this.last = null;
    }
    return this.last;
  }
}
