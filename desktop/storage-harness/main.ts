/**
 * Electron side of the storage soak (P2.6; plan T1–T8). Runs the real
 * storage worker (`worker.cjs`, `node:sqlite`) from a windowless,
 * dock-less Electron main. `tests/load/desktop-durability-soak.ts` (Bun)
 * launches it, kills it, and verifies the library afterwards with the
 * engine on `bun:sqlite`.
 *
 * Modes (`--mode=`):
 * - `contract`: the engine `DocStore` cases over the worker (`CASE_OK` /
 *   `CASE_FAIL` lines).
 * - `churn`: edits a document with product batching (or `--dense`) until
 *   killed; `--target=compaction` compacts after every ack;
 *   `--quit-after-ms` runs the quit flush instead (T4). The worker prints
 *   `BATCH_BEGIN` / `ACK <seq>` / `COMPACT_BEGIN` / `COMPACT_ACK`; main
 *   prints `EDITS <seq> <k>` once it has the ack.
 * - `migrate`: opens the library on main's thread with the T5 format steps.
 * - `readonly`: opens a newer library (T6) and tries to write.
 * - `commit-timing`: append round trips with `fullfsync` on or off (T3).
 * - `startup`: worker spawn → ready → sidebar rows (T8, the §10 budget).
 *
 * An uncaught throw in Electron main opens a modal dialog, so every failure
 * exits with `process.exit(1)` after printing `HARNESS_FAIL`.
 */
import { writeSync } from "node:fs";
import path from "node:path";

import { app } from "electron";
import * as Y from "yjs";

import { createRpcDocStore } from "../../lib/platform/desktop/rpc-doc-store";
import type { DocStore } from "../../lib/platform/doc-store";
import { STORAGE_DOC_STORE_CASES } from "../../tests/helpers/storage-doc-store-cases";
import { StorageClient } from "../storage/client";
import { openNodeSqlite } from "../storage/drivers/node-sqlite";
import { Library } from "../storage/engine/library";
import { createNodeHost } from "../storage/node-host";
import { T5_STEPS, T5_TARGET } from "./format-steps";
import {
  DENSE_TIMING,
  editCount,
  PRODUCT_TIMING,
  parseArgs,
  SoakBatcher,
  seededRandom,
  TEXT,
} from "./gen";

const args = parseArgs(process.argv.slice(1));
const say = (line: string) => writeSync(1, `${line}\n`);
const fail = (detail: unknown): never => {
  const text =
    detail instanceof Error
      ? `${detail.message}\n${detail.stack}`
      : String(detail);
  writeSync(2, `HARNESS_FAIL ${text}\n`);
  process.exit(1);
};
process.on("uncaughtException", fail);
process.on("unhandledRejection", fail);

app.disableHardwareAcceleration();
// Only app.exit ends a run; there are no windows to close.
app.on("window-all-closed", () => {});

// Not __dirname: Bun.build inlines the source directory (S1, S2).
const workerPath = () => path.join(app.getAppPath(), "worker.cjs");
const dir = () => args.dir ?? fail("--dir is required");

/** Copies bytes before they are transferred, as IPC would. */
function copied<T>(value: T): T {
  if (value instanceof Uint8Array) return value.slice() as T;
  if (Array.isArray(value)) return value.map(copied) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, copied(v)]),
    ) as T;
  return value;
}

function storeFor(client: StorageClient, owner: string): DocStore {
  return createRpcDocStore((op, callArgs) =>
    op === "flush"
      ? (client.call("flush", {}) as never)
      : (client.call(op, { ...copied(callArgs), owner } as never) as never),
  );
}

async function contract() {
  const client = await StorageClient.start(workerPath(), { dir: dir() });
  let failed = 0;
  for (const [i, testCase] of STORAGE_DOC_STORE_CASES.entries()) {
    const stores = new Map<string, DocStore>();
    try {
      await testCase.run({
        store(owner) {
          const key = `${i}:${owner}`;
          let store = stores.get(key);
          if (!store) {
            store = storeFor(client, key);
            stores.set(key, store);
          }
          return store;
        },
        createDoc: async () => (await client.call("createDoc", {})).id,
      });
      say(`CASE_OK ${testCase.name}`);
    } catch (error) {
      failed += 1;
      say(`CASE_FAIL ${testCase.name}: ${String(error)}`);
    }
  }
  say(`STATS ${JSON.stringify(await client.call("stats", {}))}`);
  say(`SHUTDOWN ${await client.shutdown()}`);
  if (failed > 0) fail(`${failed} contract case(s) failed`);
}

async function churn() {
  const docId = args.doc ?? fail("--doc is required");
  const random = seededRandom(Number(args.seed ?? 1));
  const client = await StorageClient.start(workerPath(), {
    dir: dir(),
    trace: true,
    synchronous: args.synchronous === "OFF" ? "OFF" : "FULL",
    fullfsync: args.fullfsync !== "0",
  });
  const owner = "churn";
  const loaded = await client.call("load", { docId, owner });
  const doc = new Y.Doc();
  if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot);
  for (const update of loaded.updates) Y.applyUpdate(doc, update);
  let k =
    editCount(doc.getText(TEXT).toString()) ?? fail("stored text is broken");
  let ackedSeq = loaded.maxSeq;
  const compactEvery = args.target === "compaction";

  const batcher = new SoakBatcher(
    args.dense ? DENSE_TIMING : PRODUCT_TIMING,
    async (update, lastEdit) => {
      ackedSeq = await client.call("append", {
        docId,
        owner,
        record: { origin: "local", update },
      });
      say(`EDITS ${ackedSeq} ${lastEdit}`);
      if (compactEvery) {
        // Same task as the encode: no append is in flight (architecture §5.2).
        const state = Y.encodeStateAsUpdate(doc);
        await client.call("compact", {
          docId,
          owner,
          state,
          upToSeq: ackedSeq,
        });
      }
    },
  );
  let pendingEdit: Uint8Array | null = null;
  doc.on("update", (update: Uint8Array) => {
    pendingEdit = update;
  });
  const quitAfter = args["quit-after-ms"]
    ? Number(args["quit-after-ms"])
    : null;
  const started = performance.now();
  say(`READY ${k}`);
  for (;;) {
    // A burst of 1–8 edits 2–10 ms apart, then a 260–400 ms pause.
    const burst = 1 + Math.floor(random() * 8);
    for (let i = 0; i < burst; i += 1) {
      k += 1;
      const text = doc.getText(TEXT);
      text.insert(text.length, `${k};`);
      if (pendingEdit) batcher.push(pendingEdit, k);
      pendingEdit = null;
      await new Promise((r) => setTimeout(r, 2 + random() * 8));
    }
    if (quitAfter !== null && performance.now() - started >= quitAfter) break;
    await new Promise((r) => setTimeout(r, 260 + random() * 140));
  }
  // T4: the quit flush (architecture §8.2): flush every batch, then shut
  // the worker down.
  await batcher.flush();
  const outcome = await client.shutdown();
  say(`QUIT ${outcome} ${k} ${ackedSeq}`);
}

async function migrate() {
  say("READY");
  const library = Library.open({
    dir: dir(),
    host: createNodeHost(),
    openSqlite: openNodeSqlite,
    formatVersion: T5_TARGET,
    formatSteps: T5_STEPS,
  });
  say(`MIGRATED ${library.status.formatVersion} ${library.status.readOnly}`);
  library.shutdown();
}

async function readonly() {
  const client = await StorageClient.start(workerPath(), { dir: dir() });
  say(`STATUS ${JSON.stringify(client.status)}`);
  const sidebar = await client.call("sidebar", {});
  say(`SIDEBAR ${sidebar.docs.length}`);
  try {
    await client.call("createDoc", {});
    say("WRITE accepted");
  } catch (error) {
    say(`WRITE refused ${(error as { code?: string }).code}`);
  }
  say(`SHUTDOWN ${await client.shutdown()}`);
}

function percentile(sorted: number[], p: number) {
  return (
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0
  );
}

async function commitTiming() {
  const count = Number(args.count ?? 300);
  const client = await StorageClient.start(workerPath(), {
    dir: dir(),
    fullfsync: args.fullfsync !== "0",
  });
  const { id } = await client.call("createDoc", {});
  await client.call("load", { docId: id, owner: "timing" });
  const doc = new Y.Doc();
  const times: number[] = [];
  for (let i = 0; i < count; i += 1) {
    let update: Uint8Array = new Uint8Array();
    doc.once("update", (u: Uint8Array) => {
      update = u;
    });
    doc.getText(TEXT).insert(0, "y".repeat(4096));
    const t0 = performance.now();
    await client.call("append", {
      docId: id,
      owner: "timing",
      record: { origin: "local", update },
    });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const stats = await client.call("stats", {});
  say(
    `TIMING ${JSON.stringify({
      fullfsync: args.fullfsync !== "0",
      count,
      p50: percentile(times, 0.5),
      p95: percentile(times, 0.95),
      max: times.at(-1),
      pragmas: stats.pragmas,
      sqlite: stats.sqliteVersion,
    })}`,
  );
  await client.shutdown();
}

async function startup() {
  // performance.now() counts from process start in Node and Electron main.
  const spawnAt = performance.now();
  const client = await StorageClient.start(workerPath(), { dir: dir() });
  const readyAt = performance.now();
  const sidebar = await client.call("sidebar", {});
  const rowsAt = performance.now();
  say(
    `STARTUP ${JSON.stringify({
      processToSpawnMs: spawnAt,
      workerReadyMs: readyAt - spawnAt,
      openMs: client.timings.openMs,
      sidebarCallMs: rowsAt - readyAt,
      processToSidebarMs: rowsAt,
      spawnToSidebarMs: rowsAt - spawnAt,
      docs: sidebar.docs.length,
      folders: sidebar.folders.length,
      uncleanExit: client.status.uncleanExit,
    })}`,
  );
  await client.shutdown();
}

const MODES: Record<string, () => Promise<void>> = {
  contract,
  churn,
  migrate,
  readonly,
  "commit-timing": commitTiming,
  startup,
};

app.whenReady().then(async () => {
  app.dock?.hide();
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  const run = MODES[args.mode ?? ""] ?? fail(`unknown --mode=${args.mode}`);
  await run();
  app.exit(0);
}, fail);
