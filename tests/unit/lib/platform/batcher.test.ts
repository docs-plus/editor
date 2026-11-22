import { beforeEach, describe, expect, it } from "bun:test";

import * as Y from "yjs";

import {
  BATCH_IDLE_MS,
  BATCH_MAX_WAIT_MS,
  Batcher,
  type BatcherHealth,
  type BatcherOptions,
  COMPACT_MAX_ROWS,
  RETRY_BASE_MS,
  SAVING_BEHIND_BYTES,
} from "@/lib/platform/batcher";
import type { AppendRecord, DocStore } from "@/lib/platform/doc-store";
import {
  MemoryDocLibrary,
  MemoryDocStore,
} from "@/lib/platform/memory-doc-store";
import { FakeClock, settle } from "@/tests/helpers/platform-fakes";

const DOC = "doc";

/** Records every append; `hold()` keeps the next appends pending until `release()`. */
class RecordingStore implements DocStore {
  readonly appends: AppendRecord[] = [];
  readonly compactions: { state: Uint8Array; upToSeq: number }[] = [];
  private gate: Promise<void> | null = null;
  private open: (() => void) | null = null;
  inFlight = 0;
  maxInFlight = 0;

  constructor(readonly inner: MemoryDocStore) {}

  hold(): void {
    this.gate = new Promise((resolve) => {
      this.open = resolve;
    });
  }

  release(): void {
    this.open?.();
    this.gate = null;
  }

  load(docId: string) {
    return this.inner.load(docId);
  }

  async append(docId: string, record: AppendRecord): Promise<number> {
    this.inFlight++;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      if (this.gate) await this.gate;
      const seq = await this.inner.append(docId, record);
      this.appends.push(record);
      return seq;
    } finally {
      this.inFlight--;
    }
  }

  async compact(docId: string, state: Uint8Array, upToSeq: number) {
    this.compactions.push({ state, upToSeq });
    return this.inner.compact(docId, state, upToSeq);
  }

  close(docId: string) {
    return this.inner.close(docId);
  }

  flush() {
    return this.inner.flush();
  }
}

let clock: FakeClock;
let library: MemoryDocLibrary;
let memory: MemoryDocStore;
let store: RecordingStore;
let source: Y.Doc;

beforeEach(async () => {
  clock = new FakeClock();
  library = new MemoryDocLibrary();
  memory = new MemoryDocStore({ library });
  store = new RecordingStore(memory);
  source = new Y.Doc();
  // This client holds the document, so tests can seed rows through `memory`.
  await memory.load(DOC);
});

async function makeBatcher(options: Partial<BatcherOptions> = {}) {
  const loaded = await store.load(DOC);
  return new Batcher({ store, docId: DOC, clock, loaded, ...options });
}

/** Types `text` into the source doc and returns its update. */
function type(text: string): Uint8Array {
  const before = Y.encodeStateVector(source);
  source.getText("t").insert(source.getText("t").length, text);
  return Y.encodeStateAsUpdate(source, before);
}

function storedText(): string {
  const doc = new Y.Doc();
  for (const record of store.appends) Y.applyUpdate(doc, record.update);
  return doc.getText("t").toString();
}

describe("Batcher timing", () => {
  it("sends one merged append 250 ms after the last update", async () => {
    const batcher = await makeBatcher();
    batcher.push("local", type("a"));
    await clock.advance(100);
    batcher.push("local", type("b"));
    await clock.advance(100);
    batcher.push("local", type("c"));
    await clock.advance(BATCH_IDLE_MS - 1);
    expect(store.appends).toHaveLength(0);
    await clock.advance(1);
    expect(store.appends).toHaveLength(1);
    expect(storedText()).toBe("abc");
  });

  it("sends at most 1 s after the first update while typing continues", async () => {
    const batcher = await makeBatcher();
    for (let t = 0; t < BATCH_MAX_WAIT_MS; t += 100) {
      batcher.push("local", type("x"));
      await clock.advance(100);
    }
    expect(store.appends).toHaveLength(1);
    expect(clock.now()).toBe(BATCH_MAX_WAIT_MS);
  });

  it("keeps origins apart and in order", async () => {
    const batcher = await makeBatcher();
    batcher.push("local", type("a"));
    batcher.push("migration", type("b"), 2);
    batcher.push("local", type("c"));
    await batcher.flush();
    expect(store.appends.map((a) => a.origin)).toEqual([
      "local",
      "migration",
      "local",
    ]);
    expect(store.appends[1].schemaTo).toBe(2);
    expect(store.appends[0].schemaTo).toBeUndefined();
    expect(storedText()).toBe("abc");
  });

  it("keeps one append in flight per document", async () => {
    const batcher = await makeBatcher();
    store.hold();
    batcher.push("local", type("a"));
    await clock.advance(BATCH_IDLE_MS);
    batcher.push("local", type("b"));
    await clock.advance(2 * BATCH_MAX_WAIT_MS);
    expect(store.inFlight).toBe(1);
    store.release();
    await clock.advance(0);
    expect(store.maxInFlight).toBe(1);
    expect(storedText()).toBe("ab");
  });

  it("does not restart the 1 s wait while queued behind an append", async () => {
    const batcher = await makeBatcher();
    store.hold();
    batcher.push("local", type("a"));
    await clock.advance(BATCH_IDLE_MS); // t=250: "a" in flight
    batcher.push("local", type("b")); // first queued update at t=250
    await clock.advance(1200); // t=1450, past 250 + 1000
    store.release();
    await settle();
    // The ack lands after the deadline, so "b" goes at once, not 250 ms later.
    expect(store.appends).toHaveLength(2);
    expect(storedText()).toBe("ab");
  });

  it("asks describe() for the title once per send", async () => {
    let calls = 0;
    const batcher = await makeBatcher({
      describe: () => {
        calls++;
        return { title: `Title ${calls}`, snippet: "s" };
      },
    });
    for (let i = 0; i < 5; i++) batcher.push("local", type("x"));
    await batcher.flush();
    expect(calls).toBe(1);
    expect(store.appends[0]).toMatchObject({ title: "Title 1", snippet: "s" });
  });
});

describe("Batcher flush", () => {
  it("sends everything at once and resolves after the ack", async () => {
    const batcher = await makeBatcher();
    batcher.push("local", type("a"));
    batcher.push("restore", type("b"));
    await batcher.flush();
    expect(store.appends).toHaveLength(2);
    expect(batcher.unackedBytes).toBe(0);
    expect(batcher.ackedSeq).toBe(2);
  });

  it("resolves at once with nothing queued", async () => {
    const batcher = await makeBatcher();
    await batcher.flush();
    expect(store.appends).toHaveLength(0);
  });

  it("starts ackedSeq at the loaded maxSeq", async () => {
    await memory.append(DOC, { origin: "local", update: type("a") });
    await memory.append(DOC, { origin: "local", update: type("b") });
    const batcher = await makeBatcher();
    expect(batcher.ackedSeq).toBe(2);
  });
});

describe("Batcher failures", () => {
  it("keeps a failed batch queued and retries it in order with backoff", async () => {
    const health: BatcherHealth[] = [];
    const batcher = await makeBatcher({ onHealth: (h) => health.push(h) });
    memory.failNext("append", "disk_full");
    batcher.push("local", type("a"));
    await clock.advance(BATCH_IDLE_MS);
    expect(store.appends).toHaveLength(0);
    expect(health.at(-1)?.failing?.code).toBe("disk_full");

    batcher.push("migration", type("b"));
    await clock.advance(RETRY_BASE_MS - 1);
    expect(store.appends).toHaveLength(0);
    await clock.advance(1);
    expect(store.appends.map((a) => a.origin)).toEqual(["local", "migration"]);
    expect(storedText()).toBe("ab");
    expect(health.at(-1)?.failing).toBeNull();
  });

  it("never skips a batch, however many times it fails", async () => {
    const batcher = await makeBatcher();
    batcher.push("local", type("a"));
    for (let i = 0; i < 4; i++) memory.failNext("append", "io_error");
    const flushed = batcher.flush();
    let done = false;
    void flushed.then(() => {
      done = true;
    });
    await clock.advance(10 * 60_000);
    await flushed;
    expect(done).toBe(true);
    expect(storedText()).toBe("a");
  });

  it("doubles the backoff up to the cap", async () => {
    const batcher = await makeBatcher();
    for (let i = 0; i < 3; i++) memory.failNext("append", "io_error");
    batcher.push("local", type("a"));
    await clock.advance(BATCH_IDLE_MS); // fail 1
    await clock.advance(RETRY_BASE_MS); // fail 2
    await clock.advance(2 * RETRY_BASE_MS - 1);
    expect(store.appends).toHaveLength(0);
    await clock.advance(1); // fail 3
    await clock.advance(4 * RETRY_BASE_MS); // success
    expect(store.appends).toHaveLength(1);
  });

  it("retryNow retries a failed batch at once", async () => {
    const batcher = await makeBatcher();
    memory.failNext("append", "quota_exceeded");
    batcher.push("local", type("a"));
    await clock.advance(BATCH_IDLE_MS);
    expect(store.appends).toHaveLength(0);
    batcher.retryNow();
    await settle();
    expect(store.appends).toHaveLength(1);
  });

  it("reports a non-store rejection as io_error", async () => {
    const health: BatcherHealth[] = [];
    const failing: DocStore = {
      load: (id) => store.load(id),
      append: async () => {
        throw new TypeError("channel closed");
      },
      compact: (id, s, u) => store.compact(id, s, u),
      close: (id) => store.close(id),
      flush: () => store.flush(),
    };
    const batcher = new Batcher({
      store: failing,
      docId: DOC,
      clock,
      loaded: await store.load(DOC),
      onHealth: (h) => health.push(h),
    });
    batcher.push("local", type("a"));
    await clock.advance(BATCH_IDLE_MS);
    expect(health.at(-1)?.failing?.code).toBe("io_error");
  });

  it("reports saving behind past 4 MiB unacked", async () => {
    const health: BatcherHealth[] = [];
    const batcher = await makeBatcher({ onHealth: (h) => health.push(h) });
    store.hold();
    batcher.push("local", new Uint8Array(SAVING_BEHIND_BYTES / 2));
    await clock.advance(BATCH_IDLE_MS);
    expect(health.at(-1)?.behind ?? false).toBe(false);
    batcher.push("local", new Uint8Array(SAVING_BEHIND_BYTES / 2 + 1));
    expect(health.at(-1)?.behind).toBe(true);
    expect(batcher.unackedBytes).toBe(SAVING_BEHIND_BYTES + 1);
    batcher.dispose();
  });
});

describe("Batcher compaction", () => {
  it("asks for compaction past 500 rows since the snapshot", async () => {
    for (let i = 0; i < COMPACT_MAX_ROWS - 1; i++) {
      await memory.append(DOC, { origin: "local", update: type("x") });
    }
    let due = 0;
    const batcher = await makeBatcher({ onCompactDue: () => due++ });
    batcher.push("local", type("y"));
    await batcher.flush();
    expect(due).toBe(0);
    batcher.push("local", type("z"));
    await batcher.flush();
    expect(due).toBe(1);
    batcher.push("local", type("w"));
    await batcher.flush();
    expect(due).toBe(1); // asked once until a compaction runs
  });

  it("asks for compaction past 1 MiB of rows", async () => {
    let due = 0;
    const batcher = await makeBatcher({ onCompactDue: () => due++ });
    const big = new Y.Doc();
    big.getText("t").insert(0, "x".repeat(1024 * 1024 + 1));
    batcher.push("local", Y.encodeStateAsUpdate(big));
    await batcher.flush();
    expect(due).toBe(1);
  });

  it("waits for the in-flight append, then compacts up to the highest acked seq", async () => {
    const batcher = await makeBatcher();
    batcher.push("local", type("a"));
    await batcher.flush();
    store.hold();
    batcher.push("local", type("b"));
    await clock.advance(BATCH_IDLE_MS); // "b" in flight
    let encodedAt = -1;
    const compacted = batcher.compact(() => {
      encodedAt = store.appends.length;
      return Y.encodeStateAsUpdate(source);
    });
    await settle();
    expect(encodedAt).toBe(-1); // still waiting for "b"
    store.release();
    await compacted;
    expect(encodedAt).toBe(2);
    expect(store.compactions[0].upToSeq).toBe(2);
  });

  it("counts only rows appended after the compacted seq", async () => {
    for (let i = 0; i < COMPACT_MAX_ROWS; i++) {
      await memory.append(DOC, { origin: "local", update: type("x") });
    }
    let due = 0;
    const batcher = await makeBatcher({ onCompactDue: () => due++ });
    await batcher.compact(() => Y.encodeStateAsUpdate(source));
    batcher.push("local", type("y"));
    await batcher.flush();
    expect(due).toBe(0);
    expect(batcher.rowsSinceSnapshot).toBe(1);
  });

  it("returns the store's foreign state", async () => {
    const batcher = await makeBatcher();
    const result = await batcher.compact(() => Y.encodeStateAsUpdate(source));
    expect(result.foreign).toBeNull();
  });
});

describe("Batcher durability bound (simulated kill)", () => {
  /** Deterministic PRNG so a failing seed can be replayed. */
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  it("a kill loses only updates from the last second", async () => {
    for (let seed = 1; seed <= 40; seed++) {
      const random = rng(seed);
      clock = new FakeClock();
      library = new MemoryDocLibrary();
      memory = new MemoryDocStore({ library });
      store = new RecordingStore(memory);
      source = new Y.Doc();
      await memory.load(DOC);
      const batcher = await makeBatcher();
      const killAt = 1000 + Math.floor(random() * 6000);
      const pushedAt = new Map<string, number>();
      let id = 0;
      while (clock.now() < killAt) {
        const token = `<${id++}>`;
        pushedAt.set(token, clock.now());
        batcher.push(random() < 0.05 ? "restore" : "local", type(token));
        // Bursts of typing with pauses, sometimes longer than the idle delay.
        const gap = random() < 0.1 ? 300 + random() * 900 : random() * 120;
        await clock.advance(Math.min(Math.ceil(gap), killAt - clock.now()));
      }
      // Kill: nothing after this point runs. What was acked is in the store.
      batcher.dispose();
      const loaded = await memory.load(DOC);
      const reopened = new Y.Doc();
      for (const update of loaded.updates) Y.applyUpdate(reopened, update);
      const saved = reopened.getText("t").toString();
      for (const [token, at] of pushedAt) {
        if (at <= killAt - BATCH_MAX_WAIT_MS) {
          if (!saved.includes(token)) {
            throw new Error(
              `seed ${seed}: ${token} typed at ${at} ms lost by a kill at ${killAt} ms`,
            );
          }
        }
      }
    }
  });
});
