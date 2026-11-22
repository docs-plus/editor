/**
 * The `BlobStore` contract (image store spec §3.1, §3.4, §8): every store
 * passes the same cases. They run on `MemoryBlobStore` under `bun test`
 * today; P2.6b runs them on the desktop engine and W11 on `IdbBlobStore`.
 *
 * Plain data, `{ name, run(harness) }`, asserting with `node:assert/strict`,
 * with no Bun or DOM API and no timers, like `doc-store-contract.ts`. Time is
 * the harness clock the case moves by hand. Errors are matched by `code`.
 *
 * The last case is the §3.4 GC property test: seeded random sequences of
 * insert, remove, undo, compact, purge, daily copy, restore, clock advance
 * and `gc`, checking after every step that each hash referenced by a current
 * state or by a daily copy younger than 7 days still has its bytes.
 */
import assert from "node:assert/strict";

import { ASSET_GC_GRACE_MS, type BlobStore } from "@/lib/platform/blob-store";
import { ascii, buildPng, pngChunk } from "@/tests/helpers/image-bytes";

const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 10, 22);

export type BlobStoreHarness = {
  /** The store can add `version` rows (`addVersionRef`). */
  versions?: boolean;
  /** A new empty store that reads time from `now`. */
  createStore(now: () => number): Promise<{
    store: BlobStore;
    /**
     * Adds a `doc_blobs` row of kind `version`, as a Live version save
     * (P4.8) will. Omit it until the store can; the `versions` cases skip.
     */
    addVersionRef?: (docId: string, hex: string) => Promise<void> | void;
    dispose(): Promise<void>;
  }>;
};

export type BlobStoreContractCase = {
  name: string;
  /** Skips the case when the store lacks this capability. */
  requires?: "versions";
  run(harness: BlobStoreHarness): Promise<void>;
};

/** A distinct valid PNG for each `n`. */
export function contractImage(n: number): Uint8Array<ArrayBuffer> {
  return buildPng([pngChunk("tEXt", ascii(`n\0${n}`))]);
}

type Clock = { now: number; advance(ms: number): void };

type Extras = {
  addVersionRef?: (docId: string, hex: string) => Promise<void> | void;
};

async function withStore(
  harness: BlobStoreHarness,
  body: (store: BlobStore, clock: Clock, extras: Extras) => Promise<void>,
): Promise<void> {
  const clock: Clock = {
    now: START,
    advance(ms) {
      this.now += ms;
    },
  };
  const { store, dispose, ...extras } = await harness.createStore(
    () => clock.now,
  );
  try {
    await body(store, clock, extras);
  } finally {
    await dispose();
  }
}

async function assertRejectsWith(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await assert.rejects(promise, (error: unknown) => {
    assert.equal((error as { code?: unknown } | null)?.code, code);
    return true;
  });
}

async function bytesOf(store: BlobStore, hex: string): Promise<Uint8Array> {
  const blob = await store.get(hex);
  assert.ok(blob, `bytes for ${hex.slice(0, 8)}`);
  return new Uint8Array(await blob.arrayBuffer());
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    bytes as Uint8Array<ArrayBuffer>,
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** mulberry32: a small seeded PRNG, so a failing sequence replays. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type DailyCopy = { at: number; states: Map<string, Set<string>> };

async function runGcSequence(
  harness: BlobStoreHarness,
  seed: number,
  steps: number,
): Promise<void> {
  await withStore(harness, async (store, clock) => {
    const random = prng(seed);
    const pick = <T>(items: readonly T[]): T =>
      items[Math.floor(random() * items.length)];
    const docs = ["doc-a", "doc-b", "doc-c"];
    /** Each document's current state: the hashes its Y.Doc references. */
    const states = new Map(docs.map((d) => [d, new Set<string>()]));
    /** Hashes removed by an edit, with when: undo may bring them back. */
    const removed = new Map(docs.map((d) => [d, new Map<string, number>()]));
    const copies: DailyCopy[] = [];
    const known: string[] = [];
    let nextImage = 0;
    const log: string[] = [];

    const referenced = (): Set<string> => {
      const all = new Set<string>();
      for (const state of states.values()) for (const h of state) all.add(h);
      for (const copy of copies) {
        if (clock.now - copy.at >= 7 * DAY) continue;
        for (const state of copy.states.values()) {
          for (const h of state) all.add(h);
        }
      }
      return all;
    };

    for (let step = 0; step < steps; step++) {
      const doc = pick(docs);
      const state = states.get(doc) ?? new Set<string>();
      const roll = random();
      if (roll < 0.22) {
        // Insert: new bytes, or bytes another document already uses.
        const reuse = known.length > 0 && random() < 0.4;
        const n = reuse ? -1 : nextImage++;
        const bytes = reuse ? null : contractImage(n);
        const hex = bytes
          ? (await store.put(doc, bytes, "image/png")).hex
          : pick(known);
        if (!bytes) {
          // Pasting a known ref puts its bytes again (they are present).
          const present = await store.get(hex);
          if (!present) continue;
          await store.put(
            doc,
            new Uint8Array(await present.arrayBuffer()),
            "image/png",
          );
        }
        if (!known.includes(hex)) known.push(hex);
        state.add(hex);
        log.push(`${step} insert ${doc} ${hex.slice(0, 6)}`);
      } else if (roll < 0.36 && state.size > 0) {
        const hex = pick([...state]);
        state.delete(hex);
        removed.get(doc)?.set(hex, clock.now);
        log.push(`${step} remove ${doc} ${hex.slice(0, 6)}`);
      } else if (roll < 0.44) {
        // Undo within a week brings a removed image back.
        const recent = [...(removed.get(doc) ?? new Map())].filter(
          ([, at]) => clock.now - at < 7 * DAY,
        );
        if (recent.length === 0) continue;
        const [hex] = pick(recent);
        removed.get(doc)?.delete(hex);
        assert.deepEqual(
          await store.has([hex]),
          [hex],
          `undo needs bytes: ${log.slice(-12).join(" | ")}`,
        );
        state.add(hex);
        log.push(`${step} undo ${doc} ${hex.slice(0, 6)}`);
      } else if (roll < 0.6) {
        await store.recount(doc, [...state]);
        log.push(`${step} compact ${doc}`);
      } else if (roll < 0.64) {
        // Purge after Trash: the document is gone for good.
        state.clear();
        removed.get(doc)?.clear();
        await store.recount(doc, []);
        log.push(`${step} purge ${doc}`);
      } else if (roll < 0.72) {
        copies.push({
          at: clock.now,
          states: new Map(
            [...states].map(([d, s]) => [d, new Set(s)] as const),
          ),
        });
        log.push(`${step} daily-copy`);
      } else if (roll < 0.78) {
        const fresh = copies.filter((c) => clock.now - c.at < 7 * DAY);
        if (fresh.length === 0) continue;
        const copy = pick(fresh);
        const restored = new Set(copy.states.get(doc));
        assert.deepEqual(
          (await store.has([...restored])).sort(),
          [...restored].sort(),
          `restore needs bytes: ${log.slice(-12).join(" | ")}`,
        );
        states.set(doc, restored);
        log.push(`${step} restore ${doc}`);
      } else if (roll < 0.92) {
        clock.advance(Math.floor(random() * 4 * DAY));
        log.push(`${step} advance`);
      } else {
        await store.gc(clock.now);
        log.push(`${step} gc`);
      }

      const needed = [...referenced()];
      assert.deepEqual(
        (await store.has(needed)).sort(),
        needed.sort(),
        `seed ${seed} step ${step}: ${log.slice(-12).join(" | ")}`,
      );
    }
  });
}

export const BLOB_STORE_CONTRACT: readonly BlobStoreContractCase[] = [
  {
    name: "put returns the SHA-256 of the bytes, and get returns them typed",
    run: (harness) =>
      withStore(harness, async (store) => {
        const bytes = contractImage(1);
        const { hex } = await store.put("doc-a", bytes, "image/png");
        assert.equal(hex, await sha256(bytes));
        assert.deepEqual(await bytesOf(store, hex), bytes);
        assert.equal((await store.get(hex))?.type, "image/png");
        assert.deepEqual(await store.has([hex]), [hex]);
      }),
  },
  {
    name: "putting the same bytes again dedupes",
    run: (harness) =>
      withStore(harness, async (store) => {
        const first = await store.put("doc-a", contractImage(1), "image/png");
        const second = await store.put("doc-b", contractImage(1), "image/png");
        assert.equal(first.hex, second.hex);
      }),
  },
  {
    name: "put refuses a mismatched type, SVG, a truncated header and oversize bytes",
    run: (harness) =>
      withStore(harness, async (store) => {
        const png = contractImage(1);
        await assertRejectsWith(
          store.put("doc-a", png, "image/jpeg"),
          "invalid_image",
        );
        await assertRejectsWith(
          store.put("doc-a", ascii("<svg/>"), "image/png"),
          "invalid_image",
        );
        await assertRejectsWith(
          store.put("doc-a", png.subarray(0, 16), "image/png"),
          "invalid_image",
        );
        const huge = new Uint8Array(2 * 1024 * 1024 + 1);
        huge.set(png);
        await assertRejectsWith(
          store.put("doc-a", huge, "image/png"),
          "too_large",
        );
        assert.deepEqual(await store.has([await sha256(png)]), []);
      }),
  },
  {
    name: "unknown hashes are missing",
    run: (harness) =>
      withStore(harness, async (store) => {
        const hex = "0".repeat(64);
        assert.equal(await store.get(hex), null);
        assert.equal(store.url(hex), null);
        assert.deepEqual(await store.has([hex]), []);
      }),
  },
  {
    name: "has keeps the order it was given",
    run: (harness) =>
      withStore(harness, async (store) => {
        const a = (await store.put("d", contractImage(1), "image/png")).hex;
        const b = (await store.put("d", contractImage(2), "image/png")).hex;
        const none = "f".repeat(64);
        assert.deepEqual(await store.has([b, none, a]), [b, a]);
      }),
  },
  {
    name: "url is null or a stable string for a present blob",
    run: (harness) =>
      withStore(harness, async (store) => {
        const { hex } = await store.put("d", contractImage(1), "image/png");
        const url = store.url(hex);
        if (url !== null) {
          assert.equal(typeof url, "string");
          assert.equal(store.url(hex), url);
        }
      }),
  },
  {
    name: "a provisional row keeps its blob until a recount drops it",
    run: (harness) =>
      withStore(harness, async (store, clock) => {
        const { hex } = await store.put("d", contractImage(1), "image/png");
        clock.advance(ASSET_GC_GRACE_MS * 3);
        assert.deepEqual(await store.gc(clock.now), { deleted: 0, bytes: 0 });
        assert.deepEqual(await store.has([hex]), [hex]);
        await store.recount("d", []);
        clock.advance(ASSET_GC_GRACE_MS);
        const result = await store.gc(clock.now);
        assert.equal(result.deleted, 1);
        assert.equal(result.bytes, contractImage(1).byteLength);
        assert.deepEqual(await store.has([hex]), []);
      }),
  },
  {
    name: "a current reference is never collected",
    run: (harness) =>
      withStore(harness, async (store, clock) => {
        const { hex } = await store.put("d", contractImage(1), "image/png");
        await store.recount("d", [hex]);
        clock.advance(ASSET_GC_GRACE_MS * 10);
        await store.gc(clock.now);
        assert.deepEqual(await store.has([hex]), [hex]);
      }),
  },
  {
    name: "a dropped reference survives the grace period, then goes",
    run: (harness) =>
      withStore(harness, async (store, clock) => {
        const { hex } = await store.put("d", contractImage(1), "image/png");
        await store.recount("d", [hex]);
        await store.recount("d", []);
        clock.advance(ASSET_GC_GRACE_MS - 1);
        await store.gc(clock.now);
        assert.deepEqual(await store.has([hex]), [hex]);
        clock.advance(1);
        await store.gc(clock.now);
        assert.deepEqual(await store.has([hex]), []);
      }),
  },
  {
    name: "a recount does not move an earlier drop time",
    run: (harness) =>
      withStore(harness, async (store, clock) => {
        const { hex } = await store.put("d", contractImage(1), "image/png");
        await store.recount("d", []);
        clock.advance(ASSET_GC_GRACE_MS / 2);
        await store.recount("d", []);
        clock.advance(ASSET_GC_GRACE_MS / 2);
        await store.gc(clock.now);
        assert.deepEqual(await store.has([hex]), []);
      }),
  },
  {
    name: "another document's reference keeps a shared blob",
    run: (harness) =>
      withStore(harness, async (store, clock) => {
        const { hex } = await store.put("a", contractImage(1), "image/png");
        await store.put("b", contractImage(1), "image/png");
        await store.recount("b", [hex]);
        await store.recount("a", []);
        clock.advance(ASSET_GC_GRACE_MS * 2);
        await store.gc(clock.now);
        assert.deepEqual(await store.has([hex]), [hex]);
      }),
  },
  {
    name: "referencing a dropped blob again clears the drop",
    run: (harness) =>
      withStore(harness, async (store, clock) => {
        const { hex } = await store.put("d", contractImage(1), "image/png");
        await store.recount("d", []);
        clock.advance(ASSET_GC_GRACE_MS - DAY);
        await store.recount("d", [hex]);
        clock.advance(ASSET_GC_GRACE_MS * 2);
        await store.gc(clock.now);
        assert.deepEqual(await store.has([hex]), [hex]);
      }),
  },
  {
    name: "putting a dropped blob again keeps it",
    run: (harness) =>
      withStore(harness, async (store, clock) => {
        const { hex } = await store.put("d", contractImage(1), "image/png");
        await store.recount("d", []);
        clock.advance(ASSET_GC_GRACE_MS - DAY);
        await store.put("d", contractImage(1), "image/png");
        clock.advance(ASSET_GC_GRACE_MS * 2);
        await store.gc(clock.now);
        assert.deepEqual(await store.has([hex]), [hex]);
      }),
  },
  {
    name: "purging a document (recount to nothing) releases all its blobs after the grace",
    run: (harness) =>
      withStore(harness, async (store, clock) => {
        const a = (await store.put("d", contractImage(1), "image/png")).hex;
        const b = (await store.put("d", contractImage(2), "image/png")).hex;
        await store.recount("d", [a, b]);
        await store.recount("d", []);
        clock.advance(ASSET_GC_GRACE_MS);
        assert.equal((await store.gc(clock.now)).deleted, 2);
        assert.deepEqual(await store.has([a, b]), []);
      }),
  },
  {
    name: "put snapshots the bytes before it hashes them",
    run: (harness) =>
      withStore(harness, async (store) => {
        const bytes = contractImage(1);
        const original = bytes.slice();
        const pending = store.put("d", bytes, "image/png");
        // The caller reuses its buffer while the store is still working.
        bytes.fill(0);
        const { hex } = await pending;
        assert.equal(hex, await sha256(original));
        assert.deepEqual(await bytesOf(store, hex), original);
      }),
  },
  {
    name: "a recount naming a hash with no stored bytes records nothing for it",
    run: (harness) =>
      withStore(harness, async (store, clock) => {
        const { hex } = await store.put("d", contractImage(1), "image/png");
        const unknown = "e".repeat(64);
        await store.recount("d", [hex, unknown]);
        assert.deepEqual(await store.has([hex, unknown]), [hex]);
        // The known hash is current: it survives any GC.
        clock.advance(ASSET_GC_GRACE_MS * 2);
        await store.gc(clock.now);
        assert.deepEqual(await store.has([hex]), [hex]);
        // Bytes that arrive later get their row then.
        await store.put("d", contractImage(2), "image/png");
      }),
  },
  {
    name: "a recount never drops a version reference",
    requires: "versions",
    run: (harness) =>
      withStore(harness, async (store, clock, { addVersionRef }) => {
        const { hex } = await store.put("d", contractImage(1), "image/png");
        await addVersionRef?.("d", hex);
        await store.recount("d", []);
        clock.advance(ASSET_GC_GRACE_MS * 2);
        await store.gc(clock.now);
        assert.deepEqual(await store.has([hex]), [hex]);
      }),
  },
  {
    name: "concurrent puts of the same bytes store one blob for both documents",
    run: (harness) =>
      withStore(harness, async (store, clock) => {
        const [a, b] = await Promise.all([
          store.put("a", contractImage(1), "image/png"),
          store.put("b", contractImage(1), "image/png"),
        ]);
        assert.equal(a.hex, b.hex);
        await store.recount("a", []);
        clock.advance(ASSET_GC_GRACE_MS * 2);
        assert.equal((await store.gc(clock.now)).deleted, 0);
        assert.deepEqual(await store.has([a.hex]), [a.hex]);
      }),
  },
  {
    name: "a put racing a gc of the same blob leaves its bytes stored",
    run: (harness) =>
      withStore(harness, async (store, clock) => {
        const { hex } = await store.put("d", contractImage(1), "image/png");
        await store.recount("d", []);
        clock.advance(ASSET_GC_GRACE_MS * 2);
        // Collectable now; a paste puts the same bytes while GC runs.
        await Promise.all([
          store.put("e", contractImage(1), "image/png"),
          store.gc(clock.now),
        ]);
        assert.deepEqual(await store.has([hex]), [hex]);
        clock.advance(ASSET_GC_GRACE_MS * 2);
        await store.gc(clock.now);
        assert.deepEqual(await store.has([hex]), [hex]);
      }),
  },
  ...[1, 2, 3, 4, 5, 6].map(
    (seed): BlobStoreContractCase => ({
      name: `GC never deletes a referenced or restorable blob (seed ${seed})`,
      run: (harness) => runGcSequence(harness, seed, 250),
    }),
  ),
];

type ContractRunner = {
  describe: (title: string, body: () => void) => void;
  it: (title: string, body: () => Promise<void>) => void;
};

/** Registers every contract case with the runner's own `describe`/`it`. */
export function defineBlobStoreContract(
  runner: ContractRunner,
  title: string,
  harness: BlobStoreHarness,
): void {
  runner.describe(title, () => {
    for (const testCase of BLOB_STORE_CONTRACT) {
      if (testCase.requires === "versions" && !harness.versions) continue;
      runner.it(testCase.name, () => testCase.run(harness));
    }
  });
}
