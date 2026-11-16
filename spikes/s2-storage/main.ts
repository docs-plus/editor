// S2 spike: Electron main. Modes:
//   pragmas      open in the worker, print the pragma read-back
//   roundtrip    append batches, a 5 MB compaction, reload == reference
//   churn        deterministic edits, batched appends (and compactions) until killed
//   verify       quick_check + rebuild, for the kill harness
//   commit-loop  4 KB commit times (durability evidence), --thread=worker|main
// Every mode prints one `RESULT <json>` line and exits 0, or `FAIL <reason>`
// and exits 1.
import { tmpdir } from "node:os";
import path from "node:path";
import { Worker } from "node:worker_threads";

import { app } from "electron";
import * as Y from "yjs";

import { runCommitLoop } from "./commit-loop";
import { line, openDatabase, type Row, type Synchronous } from "./engine";
import { applyEdit, CLIENT_ID, newGeneratorDoc, textHash } from "./gen";
import type { Request } from "./worker";

type Args = Record<string, string>;

// `--key=value` or `--key value`; a bare `--flag` is "1".
const parseArgs = (argv: string[]): Args => {
  const args: Args = {};
  argv.forEach((arg, i) => {
    const match = arg.match(/^--([\w-]+)(?:=(.*))?$/);
    if (!match?.[1]) return;
    const next = argv[i + 1];
    args[match[1]] =
      match[2] ?? (next !== undefined && !next.startsWith("--") ? next : "1");
  });
  return args;
};

const args = parseArgs(process.argv.slice(2));
const mode = args.mode ?? "pragmas";
const dbPath = args.db ?? path.join(tmpdir(), "s2.sqlite");
const synchronous = (args.synchronous ?? "FULL") as Synchronous;
const seed = Number(args.seed ?? 42);
const seedBytes = Number(args["seed-bytes"] ?? 64 * 1024);
const docId = args.doc ?? "doc";
const fullfsync = args.fullfsync !== "0";

// Keep Electron's own files out of the user's profile, and stay headless.
app.setPath("userData", path.join(tmpdir(), "s2-electron-user-data"));
app.disableHardwareAcceleration();
if (process.platform === "darwin") app.setActivationPolicy("prohibited");

// ---------------------------------------------------------------------------
// Worker client

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };
type WithoutId<T> = T extends unknown ? Omit<T, "id"> : never;

const startWorker = () => {
  // Not `__dirname`: Bun.build inlines the source directory for a
  // `"type": "module"` package. The app path is the directory of main.cjs.
  const worker = new Worker(path.join(app.getAppPath(), "worker.cjs"));
  const pending = new Map<number, Pending>();
  let nextId = 1;
  worker.on(
    "message",
    (msg: { id: number; ok: boolean; result?: unknown; error?: string }) => {
      const entry = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.ok) entry?.resolve(msg.result);
      else entry?.reject(new Error(msg.error));
    },
  );
  worker.on("error", (error) => fail(`worker: ${error}`));
  const call = <T = unknown>(request: WithoutId<Request>) =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      worker.postMessage({ ...request, id });
    });
  return { call, terminate: () => worker.terminate() };
};

type StorageWorker = ReturnType<typeof startWorker>;

// ---------------------------------------------------------------------------
// Output

const result = (value: unknown) => {
  line(`RESULT ${JSON.stringify(value)}`);
  process.exit(0);
};

function fail(reason: string): never {
  // process.exit, not a throw: an uncaught exception in main opens a dialog.
  line(`FAIL ${reason}`);
  process.exit(1);
}

const failWith = (error: unknown) => fail(String(error));

const environment = () => ({
  electron: process.versions.electron,
  chrome: process.versions.chrome,
  node: process.versions.node,
  sqlite: process.versions.sqlite,
  platform: process.platform,
  arch: process.arch,
});

// ---------------------------------------------------------------------------
// Batching: 250 ms after the last edit, at most 1 s after the first.

class BatchScheduler {
  private rows: Row[] = [];
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private maxWait: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly flushRows: (rows: Row[]) => void,
    private readonly debounceMs = 250,
    private readonly maxWaitMs = 1000,
  ) {}

  push(row: Row) {
    this.rows.push(row);
    if (!this.maxWait) {
      this.maxWait = setTimeout(() => this.flush(), this.maxWaitMs);
    }
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => this.flush(), this.debounceMs);
  }

  flush() {
    if (this.debounce) clearTimeout(this.debounce);
    if (this.maxWait) clearTimeout(this.maxWait);
    this.debounce = null;
    this.maxWait = null;
    if (this.rows.length === 0) return;
    const rows = this.rows;
    this.rows = [];
    this.flushRows(rows);
  }
}

// ---------------------------------------------------------------------------
// Rebuild

const rebuild = (loaded: { snapshot: Row | null; updates: Row[] }) => {
  const doc = new Y.Doc();
  if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot.data);
  for (const row of loaded.updates) Y.applyUpdate(doc, row.data);
  const maxSeq =
    loaded.updates[loaded.updates.length - 1]?.seq ?? loaded.snapshot?.seq ?? 0;
  return { doc, maxSeq };
};

const stateVector = (doc: Y.Doc) =>
  Buffer.from(Y.encodeStateVector(doc)).toString("base64");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Modes

const pragmas = async (worker: StorageWorker) => {
  const read = await worker.call({ type: "open", path: dbPath, synchronous });
  result({ mode, synchronous, ...environment(), pragmas: read });
};

const roundtrip = async (worker: StorageWorker) => {
  await worker.call({ type: "open", path: dbPath, synchronous });
  const reference = newGeneratorDoc();
  const big = 5 * 1024 * 1024;
  let seq = 0;
  const edit = () => {
    seq += 1;
    return { seq, data: applyEdit(reference, seed, seq, big) };
  };

  // 1. A failing batch rolls back as a whole: one transaction per batch.
  const first = [edit(), edit(), edit()];
  await worker.call({ type: "append", docId, rows: first });
  const bad = [edit(), edit(), { seq: 2, data: new Uint8Array([0]) }];
  const rolledBack = await worker
    .call({ type: "append", docId, rows: bad })
    .then(() => false)
    .catch(() => true);
  const afterBad = (await worker.call({ type: "inspect", docId })) as {
    maxSeq: number;
  };
  const batchIsOneTransaction = rolledBack && afterBad.maxSeq === 3;
  await worker.call({ type: "append", docId, rows: bad.slice(0, 2) });

  // 2. The scheduler: a 10 ms edit stream flushes at the 1 s cap, a lone
  // edit flushes 250 ms later.
  const flushes: { at: number; rows: number }[] = [];
  const t0 = performance.now();
  const scheduler = new BatchScheduler((rows) => {
    flushes.push({ at: Math.round(performance.now() - t0), rows: rows.length });
    worker.call({ type: "append", docId, rows }).catch(failWith);
  });
  const streamEnd = t0 + 2500;
  while (performance.now() < streamEnd) {
    scheduler.push(edit());
    await sleep(10);
  }
  await sleep(400);
  const lone = performance.now();
  scheduler.push(edit());
  await sleep(400);
  const loneFlush = flushes[flushes.length - 1];

  // 3. Compaction: 5 MB snapshot + covered seq, one transaction.
  const covered = seq;
  const snapshot = Y.encodeStateAsUpdate(reference);
  const compactStart = performance.now();
  await worker.call({ type: "compact", docId, seq: covered, snapshot });
  const compactMs = performance.now() - compactStart;

  // 4. More rows after the snapshot, then reload == reference.
  const tail = [edit(), edit(), edit(), edit()];
  await worker.call({ type: "append", docId, rows: tail });
  const loaded = (await worker.call({ type: "load", docId })) as {
    snapshot: Row | null;
    updates: Row[];
  };
  const { doc } = rebuild(loaded);
  const inspected = await worker.call({ type: "inspect", docId });
  const equal =
    textHash(doc) === textHash(reference) &&
    stateVector(doc) === stateVector(reference);
  const ok =
    batchIsOneTransaction &&
    equal &&
    loaded.snapshot?.seq === covered &&
    loaded.updates.length === tail.length;
  result({
    mode,
    ok,
    ...environment(),
    batchIsOneTransaction,
    flushes,
    loneFlushDelayMs: loneFlush ? Math.round(loneFlush.at - (lone - t0)) : null,
    snapshotBytes: snapshot.byteLength,
    covered,
    compactMs: Math.round(compactMs * 10) / 10,
    rowsAfterSnapshot: loaded.updates.length,
    reloadEqualsReference: equal,
    inspected,
  });
};

const churn = async (worker: StorageWorker) => {
  const pragmasRead = await worker.call({
    type: "open",
    path: dbPath,
    synchronous,
  });
  const loaded = (await worker.call({ type: "load", docId })) as {
    snapshot: Row | null;
    updates: Row[];
  };
  const { doc, maxSeq } = rebuild(loaded);
  // After loading: a local edit with a client id the loaded updates already
  // use would make Yjs pick a new id.
  doc.clientID = CLIENT_ID;
  let seq = maxSeq;
  line(`READY ${maxSeq} ${JSON.stringify(pragmasRead)}`);

  const scheduler = new BatchScheduler(
    (rows) => worker.call({ type: "append", docId, rows }).catch(failWith),
    Number(args["debounce-ms"] ?? 250),
    Number(args["max-wait-ms"] ?? 1000),
  );
  const compaction = args.target === "compaction";
  let lastCompact = performance.now();
  let compactEvery = 100 + Math.random() * 200;

  for (;;) {
    seq += 1;
    scheduler.push({ seq, data: applyEdit(doc, seed, seq, seedBytes) });
    if (compaction && performance.now() - lastCompact > compactEvery) {
      scheduler.flush();
      const snapshot = Y.encodeStateAsUpdate(doc);
      worker.call({ type: "compact", docId, seq, snapshot }).catch(failWith);
      lastCompact = performance.now();
      compactEvery = 100 + Math.random() * 200;
    }
    // Typing bursts (2–10 ms apart) and pauses past the debounce.
    await sleep(
      Math.random() < 0.7 ? 2 + Math.random() * 8 : 260 + Math.random() * 140,
    );
  }
};

const verify = async (worker: StorageWorker) => {
  await worker.call({ type: "open", path: dbPath, synchronous });
  const inspected = await worker.call({ type: "inspect", docId });
  const loaded = (await worker.call({ type: "load", docId })) as {
    snapshot: Row | null;
    updates: Row[];
  };
  const { doc, maxSeq } = rebuild(loaded);
  result({
    mode,
    inspected,
    maxSeq,
    textHash: textHash(doc),
    stateVector: stateVector(doc),
  });
};

const commitLoop = async (worker: StorageWorker) => {
  const count = Number(args.count ?? 2000);
  const size = Number(args.size ?? 4096);
  if (args.thread === "main") {
    const db = openDatabase({ path: dbPath, synchronous, fullfsync });
    const stats = runCommitLoop(db, count, size);
    db.close();
    result({ mode, thread: "main", synchronous, ...environment(), stats });
    return;
  }
  const read = await worker.call({
    type: "open",
    path: dbPath,
    synchronous,
    fullfsync,
  });
  const stats = await worker.call({ type: "commit-loop", count, size });
  result({
    mode,
    thread: "worker",
    synchronous,
    ...environment(),
    pragmas: read,
    stats,
  });
};

const MODES: Record<string, (worker: StorageWorker) => Promise<void>> = {
  pragmas,
  roundtrip,
  churn,
  verify,
  "commit-loop": commitLoop,
};

app.whenReady().then(async () => {
  const run = MODES[mode];
  if (!run) fail(`unknown mode ${mode}`);
  try {
    await run(startWorker());
  } catch (error) {
    fail(String(error instanceof Error ? error.stack : error));
  }
});
