/**
 * Deterministic edits for the durability soak, shared by the Electron churn
 * and the Bun verifier. Edit `k` appends `"<k>;"` to the text `t`, so a
 * stored document is valid exactly when its text is `1;2;…;K;` for some K:
 * a lost or half-applied batch shows up as a gap or a short K.
 *
 * `pad` is filler that makes compactions heavy (the plan's 5 MB document)
 * without touching `t`.
 */
import * as Y from "yjs";

export const TEXT = "t";
export const PAD = "pad";

/** The K of a stored text, or null if it isn't `1;2;…;K;`. */
export function editCount(text: string): number | null {
  if (text === "") return 0;
  const parts = text.split(";");
  if (parts.pop() !== "") return null;
  for (const [i, part] of parts.entries())
    if (part !== String(i + 1)) return null;
  return parts.length;
}

export function padUpdate(bytes: number): Uint8Array {
  const doc = new Y.Doc();
  // A plain repeated string compresses nothing in Yjs: one item.
  doc.getText(PAD).insert(0, "x".repeat(bytes));
  return Y.encodeStateAsUpdate(doc);
}

export type BatchTiming = { debounceMs: number; maxWaitMs: number };

/** The product's batching (architecture §5.2), or the dense soak variant. */
export const PRODUCT_TIMING: BatchTiming = { debounceMs: 250, maxWaitMs: 1000 };
export const DENSE_TIMING: BatchTiming = { debounceMs: 5, maxWaitMs: 20 };

/**
 * A minimal batcher: merges updates, flushes `debounceMs` after the last or
 * `maxWaitMs` after the first, and keeps one send in flight. Stand-in for
 * P2.1's `lib/platform/batcher.ts`, which the real app uses.
 */
export class SoakBatcher {
  private pending: Uint8Array[] = [];
  private pendingEdits = 0;
  private firstAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly timing: BatchTiming,
    private readonly send: (
      update: Uint8Array,
      lastEdit: number,
    ) => Promise<void>,
  ) {}

  push(update: Uint8Array, edit: number) {
    if (this.pending.length === 0) this.firstAt = performance.now();
    this.pending.push(update);
    this.pendingEdits = edit;
    this.schedule();
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    const sinceFirst = performance.now() - this.firstAt;
    const wait = Math.max(
      0,
      Math.min(this.timing.debounceMs, this.timing.maxWaitMs - sinceFirst),
    );
    this.timer = setTimeout(() => void this.flush(), wait);
  }

  get busy(): Promise<void> | null {
    return this.inFlight;
  }

  /** Sends what is queued, after any send in flight. */
  async flush(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    while (this.inFlight) await this.inFlight;
    if (this.pending.length === 0) return;
    const update = Y.mergeUpdates(this.pending);
    const lastEdit = this.pendingEdits;
    this.pending = [];
    this.inFlight = this.send(update, lastEdit).finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }
}

/** Parses `--key=value` and `--flag` arguments. */
export function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const arg of argv) {
    const match = arg.match(/^--([\w-]+)(?:=(.*))?$/);
    if (match?.[1]) out[match[1]] = match[2] ?? "1";
  }
  return out;
}

/** A small seeded PRNG (mulberry32), so a soak run can be replayed. */
export function seededRandom(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
