/**
 * The multi-writer compaction rule (web library §2.5, W-D3) as a property:
 * 2–3 tabs on one library append, compact and reload in random order, some
 * of them at the same time, with stale tabs appending late. After every
 * step, a fresh `load()` must hold exactly the union of every acked update.
 *
 * Seeded and printed (test strategy L2). `LIBRARY_PROPERTY_RUNS` sets the
 * run count: 2,000 by default (every PR), 50,000 in the nightly
 * `library-property` job. Seeds run from `LIBRARY_PROPERTY_BASE_SEED`,
 * which is 1 by default, so a PR run is the same every time; the nightly
 * job passes its run id. `LIBRARY_PROPERTY_SEED` replays one failing run.
 */
import { describe, expect, it } from "bun:test";

import * as Y from "yjs";

import type { DocStore } from "@/lib/platform/doc-store";
import { createFakeLibrary } from "@/tests/helpers/fake-idb";

const RUNS = Number(process.env.LIBRARY_PROPERTY_RUNS ?? 2000);
const BASE_SEED = Number(process.env.LIBRARY_PROPERTY_BASE_SEED ?? 1);
const FIXED_SEED = process.env.LIBRARY_PROPERTY_SEED;
const STEPS = 14;
/**
 * 2,000 runs take about 21 s at a load average near 90; a hang should fail
 * well before the old 10-minute cap. Large nightly counts scale it up.
 */
const TIMEOUT_MS = Math.max(120_000, RUNS * 30);

/** mulberry32: small, fast and good enough for choosing actions. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Tab = {
  store: DocStore;
  doc: Y.Doc;
  /** Highest seq loaded into or acked from `doc`. */
  upTo: number;
};

type Library = Awaited<ReturnType<typeof createFakeLibrary>>;

async function openTab(library: Library): Promise<Tab> {
  const store = library.connect();
  const loaded = await store.load("doc");
  const doc = new Y.Doc();
  if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot);
  for (const update of loaded.updates) Y.applyUpdate(doc, update);
  return { store, doc, upTo: loaded.maxSeq };
}

async function runOnce(seed: number): Promise<void> {
  const random = rng(seed);
  const pick = (n: number) => Math.floor(random() * n);
  const library = await createFakeLibrary();
  try {
    await library.createDoc("doc", 1);
    const reference = new Y.Doc();
    const tabs: Tab[] = [];
    const tabCount = 2 + pick(2);
    for (let i = 0; i < tabCount; i++) tabs.push(await openTab(library));
    let counter = 0;

    const append = async (tab: Tab) => {
      const before = Y.encodeStateVector(tab.doc);
      const text = tab.doc.getText("t");
      text.insert(pick(text.length + 1), `${counter++};`);
      const update = Y.encodeStateAsUpdate(tab.doc, before);
      const seq = await tab.store.append("doc", { origin: "local", update });
      tab.upTo = Math.max(tab.upTo, seq);
      Y.applyUpdate(reference, update);
    };
    // In one task: the state and the seq it covers (architecture §5.2).
    const compact = async (tab: Tab) => {
      const state = Y.encodeStateAsUpdate(tab.doc);
      const { foreign } = await tab.store.compact("doc", state, tab.upTo);
      if (foreign) Y.applyUpdate(tab.doc, foreign);
    };
    const reload = async (index: number) => {
      await tabs[index].store.close("doc");
      tabs[index] = await openTab(library);
    };

    for (let step = 0; step < STEPS; step++) {
      // One or two tabs act at once; a tab never compacts while its own
      // append is in flight (the batcher's precondition).
      const first = pick(tabs.length);
      const actors =
        random() < 0.4 ? [first, (first + 1) % tabs.length] : [first];
      await Promise.all(
        actors.map((index) => {
          const roll = random();
          if (roll < 0.55) return append(tabs[index]);
          if (roll < 0.85) return compact(tabs[index]);
          return reload(index);
        }),
      );

      const check = await openTab(library);
      expect(check.doc.getText("t").toString()).toBe(
        reference.getText("t").toString(),
      );
      expect(Y.encodeStateVector(check.doc)).toEqual(
        Y.encodeStateVector(reference),
      );
      expect(check.doc.store.pendingStructs).toBeNull();
      await check.store.close("doc");
    }
  } finally {
    await library.dispose();
  }
}

describe("IdbDocStore compaction with several writers (property)", () => {
  it(
    `load() equals the union of acked updates (${FIXED_SEED ? 1 : RUNS} runs)`,
    async () => {
      const base = FIXED_SEED ? Number(FIXED_SEED) : BASE_SEED >>> 0;
      const runs = FIXED_SEED ? 1 : RUNS;
      if (!FIXED_SEED && base !== 1) {
        console.info(`LIBRARY_PROPERTY_BASE_SEED=${base} (${runs} runs)`);
      }
      for (let run = 0; run < runs; run++) {
        const seed = (base + run) >>> 0;
        try {
          await runOnce(seed);
        } catch (error) {
          throw new Error(
            `failed with LIBRARY_PROPERTY_SEED=${seed}: ${String(error)}`,
          );
        }
      }
    },
    TIMEOUT_MS,
  );
});
