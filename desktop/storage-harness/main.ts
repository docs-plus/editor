/**
 * Electron side of the storage soak (P2.6; plan T1–T8). Runs the real
 * storage worker (`worker.cjs`, `node:sqlite`) from a windowless,
 * dock-less Electron main. `tests/load/desktop-durability-soak.ts` (Bun)
 * launches it, kills it, and verifies the library afterwards with the
 * engine on `bun:sqlite`.
 *
 * Modes (`--mode=`):
 * - `contract`: P2.1's shared `DocStore` contract over the worker
 *   (`CASE_OK` / `CASE_FAIL` lines), then P2.7b's `LibraryIndex` contract
 *   through `RpcLibraryIndex` over the worker (`LIBRARY_CASE_OK` /
 *   `LIBRARY_CASE_FAIL`).
 * - `churn`: edits a document with product batching (or `--dense`) until
 *   killed; `--target=compaction` compacts after every ack;
 *   `--quit-after-ms` runs the quit flush instead (T4). The worker prints
 *   `BATCH_BEGIN` / `ACK <seq>` / `COMPACT_BEGIN` / `COMPACT_ACK`; main
 *   prints `EDITS <seq> <k>` once it has the ack.
 * - `migrate`: opens the library on main's thread with the T5 format steps.
 * - `readonly`: opens a newer library (T6) and tries to write.
 * - `commit-timing`: append round trips with `fullfsync` on or off (T3).
 * - `startup`: worker spawn → ready → sidebar rows (T8, the §10 budget).
 * - `copy-quit`: quit while the daily copy runs in its thread (decision 5).
 * - `copy-time`: how long the batched daily copy takes (decision 5).
 * - `t21`: sidebar, backlinks and title search on 10,000 linked documents
 *   (offline revision §5.3).
 * - `migrate-v2`: the 1→2 step, optionally killed at a boundary (T24, T24b).
 * - `long-doc`: load, compact and grow a long document (T20, T20b).
 *
 * An uncaught throw in Electron main opens a modal dialog, so every failure
 * exits with `process.exit(1)` after printing `HARNESS_FAIL`.
 */
import { mkdtempSync, rmSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { app } from "electron";
import * as Y from "yjs";

import { createRpcDocStore } from "../../lib/platform/desktop/rpc-doc-store";
import type { DocStore } from "../../lib/platform/doc-store";
import { takeCases } from "../../tests/helpers/bun-test-shim";
import {
  DOC_STORE_CONTRACT,
  type DocStoreHarness,
} from "../../tests/helpers/doc-store-contract";
import {
  createLibraryContractFactory,
  type LibraryTransport,
  type StorageCall,
} from "../../tests/helpers/library-index-harness";
import { describeLibraryIndexContract } from "../../tests/unit/platform/document-index-contract";
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

/**
 * P2.1's shared DocStore contract on `node:sqlite` in the real worker: one
 * worker and temp library per case, one owner id per connected client.
 */
async function contract() {
  let passed = 0;
  let failed = 0;
  const harness: DocStoreHarness = {
    exclusiveOpen: true,
    async createLibrary() {
      const libraryDir = mkdtempSync(path.join(tmpdir(), "contract-"));
      const client = await StorageClient.start(workerPath(), {
        dir: libraryDir,
      });
      let clients = 0;
      return {
        connect: () => storeFor(client, `client-${++clients}`),
        async createDoc(docId, schema) {
          await client.call("createDoc", { id: docId, schema });
        },
        async dispose() {
          await client.shutdown();
          rmSync(libraryDir, {
            recursive: true,
            force: true,
            maxRetries: 10,
            retryDelay: 200,
          });
        },
      };
    },
  };
  for (const testCase of DOC_STORE_CONTRACT) {
    if (testCase.requires && !harness[testCase.requires]) continue;
    try {
      await testCase.run(harness);
      passed += 1;
      say(`CASE_OK ${testCase.name}`);
    } catch (error) {
      failed += 1;
      say(`CASE_FAIL ${testCase.name}: ${String(error)}`);
    }
  }
  say(`CONTRACT ${passed} passed, ${failed} failed`);
  const library = await libraryContract();
  if (failed > 0 || library > 0)
    fail(`${failed + library} contract case(s) failed`);
}

/** A transport to a worker on `dir`, started on first use. */
function workerTransport(dir: string): LibraryTransport {
  const listeners: ((rev: number, changes: unknown[]) => void)[] = [];
  const started = StorageClient.start(
    workerPath(),
    { dir, strictClock: true },
    {
      onIndexChanged: (rev, changes) => {
        for (const listener of listeners) listener(rev, changes);
      },
    },
  );
  // A failed start rejects every call instead.
  started.catch(() => {});
  let closed = false;
  return {
    call: (async (op, callArgs) =>
      (await started).call(op, copied(callArgs))) as StorageCall,
    onIndexChanged: (listener) => listeners.push(listener),
    async close() {
      if (closed) return;
      closed = true;
      const client = await started.catch(() => null);
      await client?.shutdown();
    },
  };
}

/**
 * P2.7b's `LibraryIndex` contract (P2.6e) through `RpcLibraryIndex` over the
 * real worker on `node:sqlite`: each case seeds a temp library on this
 * thread, shuts it down, and starts a worker on it. Returns the failures.
 */
async function libraryContract(): Promise<number> {
  const cleanups: (() => Promise<void>)[] = [];
  describeLibraryIndexContract(
    "RpcLibraryIndex on the storage worker (node:sqlite)",
    createLibraryContractFactory({
      tempDir() {
        const libraryDir = mkdtempSync(path.join(tmpdir(), "library-"));
        return {
          dir: libraryDir,
          remove: () =>
            rmSync(libraryDir, {
              recursive: true,
              force: true,
              maxRetries: 10,
              retryDelay: 200,
            }),
        };
      },
      open: (libraryDir, now) =>
        Library.open({
          dir: libraryDir,
          host: createNodeHost({ now }),
          openSqlite: openNodeSqlite,
          fullfsync: false,
        }),
      attach(libraryDir, seeded) {
        seeded?.shutdown();
        return workerTransport(libraryDir);
      },
      track: (cleanup) => cleanups.push(cleanup),
    }),
  );
  let passed = 0;
  let failed = 0;
  for (const testCase of takeCases()) {
    try {
      await testCase.run();
      passed += 1;
      say(`LIBRARY_CASE_OK ${testCase.name}`);
    } catch (error) {
      failed += 1;
      say(`LIBRARY_CASE_FAIL ${testCase.name}: ${String(error)}`);
    } finally {
      for (const cleanup of cleanups.splice(0)) await cleanup().catch(() => {});
    }
  }
  say(`LIBRARY_CONTRACT ${passed} passed, ${failed} failed`);
  return failed;
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

/**
 * T24 and T24b: the real 1→2 step (`FORMAT_STEPS`) on `node:sqlite`, on
 * main's thread like T5. Prints `BOUNDARY <k> <name>` at each statement
 * boundary; with `--kill-at=k` it SIGKILLs itself there (TerminateProcess
 * on Windows), so every boundary is hit deterministically.
 */
async function migrateV2() {
  const killAt = args["kill-at"] ? Number(args["kill-at"]) : 0;
  let boundary = 0;
  say("READY");
  const started = performance.now();
  const library = Library.open({
    dir: dir(),
    host: createNodeHost(),
    openSqlite: openNodeSqlite,
    migrationBoundary: (name) => {
      boundary += 1;
      say(`BOUNDARY ${boundary} ${name}`);
      if (boundary === killAt) process.kill(process.pid, "SIGKILL");
    },
  });
  const ms = performance.now() - started;
  say(
    `MIGRATED_V2 ${JSON.stringify({ ms, formatVersion: library.status.formatVersion, readOnly: library.status.readOnly, boundaries: boundary, foreignKeys: library.stats().pragmas.foreignKeys })}`,
  );
  library.shutdown();
}

/**
 * T20 and T20b, the storage half: load a long document through the real
 * worker, rebuild it in main as the renderer would, compact it (the I10
 * check runs in the worker), then grow it to the 32 MiB cap and delete.
 */
async function longDoc() {
  const docId = args.doc ?? fail("--doc is required");
  const client = await StorageClient.start(workerPath(), { dir: dir() });
  const owner = "long";
  const t0 = performance.now();
  const loaded = await client.call("load", { docId, owner });
  const loadMs = performance.now() - t0;
  const t1 = performance.now();
  const doc = new Y.Doc();
  if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot);
  for (const update of loaded.updates) Y.applyUpdate(doc, update);
  const applyMs = performance.now() - t1;
  const state = Y.encodeStateAsUpdate(doc);
  // Read sizes before a call: the client transfers the bytes it sends.
  const bytes = state.byteLength;
  const t2 = performance.now();
  await client.call("compact", { docId, owner, state, upToSeq: loaded.maxSeq });
  const compactMs = performance.now() - t2;
  let refused = false;
  let appended = 0;
  let deleteOk = false;
  if (args.grow) {
    const text = doc.getText("grow");
    for (let i = 0; i < 64 && !refused; i += 1) {
      let update: Uint8Array = new Uint8Array();
      doc.once("update", (u: Uint8Array) => {
        update = u;
      });
      text.insert(text.length, "g".repeat(4 * 1024 * 1024));
      const size = update.byteLength;
      try {
        await client.call("append", {
          docId,
          owner,
          record: { origin: "local", update },
        });
        appended += size;
      } catch (error) {
        refused = (error as { code?: string }).code === "document_too_large";
        if (!refused) throw error;
      }
    }
    let deletion: Uint8Array = new Uint8Array();
    doc.once("update", (u: Uint8Array) => {
      deletion = u;
    });
    text.delete(0, 1000);
    try {
      await client.call("append", {
        docId,
        owner,
        record: { origin: "local", update: deletion },
      });
      deleteOk = true;
    } catch {
      deleteOk = false;
    }
  }
  say(
    `LONGDOC ${JSON.stringify({ bytes, loadMs, applyMs, compactMs, refused, appended, deleteOk, rss: process.memoryUsage().rss })}`,
  );
  await client.shutdown();
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

/**
 * Decision 5: quit while the daily copy runs in its thread. Waits for the
 * library to go idle (the copy starts), keeps typing through the copy (the
 * writer must not wait on it), then runs the quit flush.
 */
async function copyQuit() {
  const docId = args.doc ?? fail("--doc is required");
  const client = await StorageClient.start(workerPath(), {
    dir: dir(),
    trace: true,
    idleMs: 300,
    idlePollMs: 100,
  });
  const owner = "copy-quit";
  const loaded = await client.call("load", { docId, owner });
  const doc = new Y.Doc();
  if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot);
  for (const update of loaded.updates) Y.applyUpdate(doc, update);
  let k =
    editCount(doc.getText(TEXT).toString()) ?? fail("stored text is broken");
  say(`READY ${k}`);
  // Stay idle until the copy thread is running, then type through it.
  const waitUntil = performance.now() + 10_000;
  while (!(await client.call("stats", {})).dailyCopyRunning) {
    if (performance.now() > waitUntil) fail("the daily copy never started");
    await new Promise((r) => setTimeout(r, 10));
  }
  const appendMs: number[] = [];
  const typeFor = Number(args["type-ms"] ?? 150);
  const started = performance.now();
  while (performance.now() - started < typeFor) {
    k += 1;
    let update: Uint8Array = new Uint8Array();
    doc.once("update", (u: Uint8Array) => {
      update = u;
    });
    const text = doc.getText(TEXT);
    text.insert(text.length, `${k};`);
    const t0 = performance.now();
    await client.call("append", {
      docId,
      owner,
      record: { origin: "local", update },
    });
    appendMs.push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, 20));
  }
  const quitAt = performance.now();
  const outcome = await client.shutdown();
  say(
    `QUIT ${outcome} ${k} ${Math.round(performance.now() - quitAt)} ${Math.round(Math.max(...appendMs))}`,
  );
}

/** Decision 5: how long the batched daily copy takes on node:sqlite. */
async function copyTime() {
  const client = await StorageClient.start(workerPath(), {
    dir: dir(),
    idleMs: 0,
    idlePollMs: 50,
  });
  const today = (await client.call("stats", {})).today;
  const deadline = performance.now() + 300_000;
  for (;;) {
    const stats = await client.call("stats", {});
    if (stats.lastDailyCopy === today || stats.lastDailyCopyError) {
      say(
        `COPYTIME ${JSON.stringify({
          ms: stats.lastDailyCopyMs,
          error: stats.lastDailyCopyError,
          libraryBytes: stats.bytes,
        })}`,
      );
      break;
    }
    if (performance.now() > deadline) fail("the daily copy never finished");
    await new Promise((r) => setTimeout(r, 100));
  }
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
      processToReadyMs: readyAt,
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

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN;
}

async function timed<T>(run: () => T | Promise<T>): Promise<[T, number]> {
  const t0 = performance.now();
  const value = await run();
  return [value, performance.now() - t0];
}

/** Derived rows for `t21`: `links` links to `targets`, `headings` headings. */
function derivedRows(
  targets: string[],
  links: number,
  headings: number,
  salt: number,
) {
  return {
    title: `Busy ${salt}`,
    snippet: `Body ${salt}`,
    links: Array.from({ length: links }, (_, ord) => ({
      ord,
      src_toc_id: `h${ord % headings}`,
      target_key: targets[(ord + salt) % targets.length] as string,
      target_toc_id: "",
      text: `link ${ord} ${salt}`,
      context: `context for link ${ord}`,
    })),
    headings: Array.from({ length: headings }, (_, ord) => ({
      ord,
      toc_id: `h${ord}`,
      level: 1 + (ord % 3),
      text: `Heading ${ord} ${salt}`,
    })),
  };
}

/**
 * T21 (offline revision §5.3) on a seeded `library-10k-linked`: the
 * sidebar's SQL time on `node:sqlite` (this thread, the worker's driver
 * and engine), its round trip through the real worker, backlinks for one
 * document queued behind a `putDerived` on another, and `searchTitles`.
 * Args: `--dir`, `--link-key` (the watched document's), `--busy` (the id
 * whose rows are rewritten), `--targets` (comma-separated link keys).
 */
async function t21() {
  const linkKey = args["link-key"] ?? fail("--link-key is required");
  const busy = args.busy ?? fail("--busy is required");
  const targets = (args.targets ?? fail("--targets is required")).split(",");
  const queries = ["pro", "plan", "note", "q", "zeb"];
  const rounds = Number(args.rounds ?? 30);

  const library = Library.open({
    dir: dir(),
    host: createNodeHost(),
    openSqlite: openNodeSqlite,
    fullfsync: false,
  });
  const sqlSidebar: number[] = [];
  let docs = 0;
  for (let i = 0; i < 6; i += 1) {
    const [sidebar, ms] = await timed(() => library.sidebar());
    docs = sidebar.docs.length;
    if (i > 0) sqlSidebar.push(ms);
  }
  const sqlSearch: number[] = [];
  for (const query of queries)
    sqlSearch.push((await timed(() => library.searchTitles(query)))[1]);
  const sqlBacklinks: number[] = [];
  for (let i = 0; i < 10; i += 1)
    sqlBacklinks.push((await timed(() => library.backlinks(linkKey)))[1]);
  library.shutdown();

  const client = await StorageClient.start(workerPath(), { dir: dir() });
  const ipcSidebar: number[] = [];
  for (let i = 0; i < 6; i += 1)
    ipcSidebar.push((await timed(() => client.call("sidebar", {})))[1]);
  const ipcSearch: number[] = [];
  let hits = 0;
  for (const query of queries) {
    const [found, ms] = await timed(() =>
      client.call("searchTitles", { query }),
    );
    hits += found.length;
    ipcSearch.push(ms);
  }
  const alone: number[] = [];
  for (let i = 0; i < 10; i += 1)
    alone.push((await timed(() => client.call("backlinks", { linkKey })))[1]);
  // Backlinks sent right behind a putDerived: the worker answers in order,
  // so the round trip includes the rest of that transaction.
  const behind: number[] = [];
  const derive: number[] = [];
  let backlinkRows = 0;
  for (let i = 0; i < rounds; i += 1) {
    const t0 = performance.now();
    const put = client
      .call("putDerived", {
        docId: busy,
        atSeq: 0,
        rows: derivedRows(targets, 50, 20, i + 1),
      })
      .then((result) => {
        derive.push(performance.now() - t0);
        return result;
      });
    const t1 = performance.now();
    const rows = await client.call("backlinks", { linkKey });
    behind.push(performance.now() - t1);
    backlinkRows = rows.length;
    const result = await put;
    if (result !== "ok") fail(`putDerived answered ${result}`);
  }
  await client.shutdown();
  say(
    `T21 ${JSON.stringify({
      docs,
      sidebar: {
        sqlMs: median(sqlSidebar),
        ipcFirstMs: ipcSidebar[0],
        ipcMs: median(ipcSidebar.slice(1)),
      },
      searchTitles: {
        sqlMaxMs: Math.max(...sqlSearch),
        ipcMs: median(ipcSearch),
        ipcMaxMs: Math.max(...ipcSearch),
        hits,
      },
      backlinks: {
        rows: backlinkRows,
        sqlMs: median(sqlBacklinks),
        aloneMs: median(alone),
        behindPutMs: median(behind),
        behindPutMaxMs: Math.max(...behind),
        putDerivedMs: median(derive),
      },
    })}`,
  );
}

const MODES: Record<string, () => Promise<void>> = {
  contract,
  churn,
  migrate,
  readonly,
  "commit-timing": commitTiming,
  startup,
  "copy-quit": copyQuit,
  "migrate-v2": migrateV2,
  "long-doc": longDoc,
  "copy-time": copyTime,
  t21,
};

app.whenReady().then(async () => {
  app.dock?.hide();
  if (process.platform === "darwin") app.setActivationPolicy("accessory");
  const run = MODES[args.mode ?? ""] ?? fail(`unknown --mode=${args.mode}`);
  await run();
  app.exit(0);
}, fail);
