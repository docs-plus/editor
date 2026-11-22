/**
 * Desktop durability and growth soak (plan §9 T1–T8, P2.6's exit row).
 *
 * Launches the real storage worker inside Electron (the harness in
 * `desktop/storage-harness`, built first), SIGKILLs it at chosen moments
 * (`TerminateProcess` on Windows), waits until the pid is gone, then
 * reopens the library with the engine on `bun:sqlite`, which also proves
 * the two drivers read each other's files. The shape follows spike S2's
 * kill harness.
 *
 *   bun tests/load/desktop-durability-soak.ts --case=all|contract|T1|T2|T3|T4|T4-copy|T5|T6|T8|T21
 *     [--kills=200] [--out=soak-out] [--verbose]
 *
 * T7 (slow-hydrate overwrite) is a web-library case: it tests the session
 * layer, not storage, and runs with W2.
 *
 * Writes `<out>/<case>.json` and a Markdown table to `$GITHUB_STEP_SUMMARY`.
 * Exits 1 if any case fails. Run it only on CI runners (it starts
 * Electron); on a desktop machine the windows stay hidden but it still
 * takes the CPU for minutes.
 */

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import * as Y from "yjs";

import { openBunSqlite } from "@/desktop/dev/bun-sqlite-driver";
import { DAILY_KEEP } from "@/desktop/storage/engine/daily-copy";
import {
  IDLE_MS,
  LIBRARY_FILE,
  Library,
  type OpenLibraryOptions,
} from "@/desktop/storage/engine/library";
import { LOCK_FILE } from "@/desktop/storage/engine/lock";
import { updatesInvariant } from "@/desktop/storage/engine/migrations";
import { createNodeHost } from "@/desktop/storage/node-host";
import {
  STEP_ROWS,
  T5_STEPS,
  T5_TARGET,
} from "@/desktop/storage-harness/format-steps";
import {
  editCount,
  PAD,
  padUpdate,
  parseArgs,
  seededRandom,
  TEXT,
} from "@/desktop/storage-harness/gen";
import {
  docId as v1DocId,
  writeFormat1Library,
} from "@/tests/helpers/format-1-library";
import { caseT21 } from "@/tests/load/desktop-soak-t21";

const ROOT = join(import.meta.dir, "../..");
const HARNESS = join(ROOT, "desktop/storage-harness");
const args = parseArgs(process.argv.slice(2));
const OUT = args.out ?? "soak-out";
const KILLS = Number(args.kills ?? 200);
const isWindows = process.platform === "win32";

mkdirSync(OUT, { recursive: true });

const harnessMain = join(HARNESS, "dist", "main.cjs");
/** The harness's own Electron (its package has the dependency, not the root). */
function electronBinary(): string {
  if (!existsSync(harnessMain))
    throw new Error(
      "build the harness first: cd desktop/storage-harness && bun run build",
    );
  return createRequire(join(HARNESS, "package.json"))("electron") as string;
}

type CaseResult = {
  name: string;
  pass: boolean;
  summary: string;
  details: Record<string, unknown>;
  failures: string[];
};

const note = (text: string) => {
  if (args.verbose) console.log(text);
};

/**
 * Removes a temp library. On Windows, Defender or the indexer may still hold
 * a file for a moment; a cleanup failure is logged, never a failed case.
 */
function removeDir(dir: string) {
  try {
    rmSync(dir, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 200,
    });
  } catch (error) {
    console.warn(`could not remove ${dir}: ${String(error)}`);
  }
}

// ── Engine access (bun:sqlite) ──────────────────────────────────────────

function openEngine(
  dir: string,
  options: Partial<OpenLibraryOptions> = {},
): Library {
  return Library.open({
    dir,
    host: createNodeHost(),
    openSqlite: openBunSqlite,
    fullfsync: false,
    ...options,
  });
}

function textOf(library: Library, docId: string, owner = "verify") {
  const loaded = library.load(docId, owner);
  const doc = new Y.Doc();
  if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot);
  for (const update of loaded.updates) Y.applyUpdate(doc, update);
  library.close(docId, owner);
  return {
    text: doc.getText(TEXT).toString(),
    padLength: doc.getText(PAD).length,
    maxSeq: loaded.maxSeq,
  };
}

function seedLibrary(dir: string, padBytes: number): string {
  const library = openEngine(dir);
  const { id } = library.createDoc({ title: "Soak" });
  if (padBytes > 0) {
    library.load(id, "seed");
    const seq = library.append(id, "seed", {
      origin: "local",
      update: padUpdate(padBytes),
    });
    const doc = new Y.Doc();
    Y.applyUpdate(doc, padUpdate(padBytes));
    library.compact(id, "seed", Y.encodeStateAsUpdate(doc), seq);
    library.close(id, "seed");
  }
  library.shutdown();
  return id;
}

// ── Electron runs ───────────────────────────────────────────────────────

type Run = {
  lines: string[];
  exitCode: number | null;
  stderr: string;
  pid: number;
};

function pidGone(pid: number): boolean {
  if (isWindows) {
    const out = Bun.spawnSync(["tasklist", "/FI", `PID eq ${pid}`, "/NH"]);
    return !out.stdout.toString().includes(` ${pid} `);
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as { code?: string }).code === "ESRCH";
  }
}

/**
 * Starts the harness and feeds each stdout line to `onLine`, which may
 * return "kill" to SIGKILL the process. Resolves once the process exited
 * and its pid is gone.
 */
async function runHarness(
  harnessArgs: string[],
  onLine: (line: string, kill: () => void) => void = () => {},
  timeoutMs = 120_000,
): Promise<Run & { killed: boolean }> {
  const proc = Bun.spawn([electronBinary(), harnessMain, ...harnessArgs], {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ELECTRON_ENABLE_STACK_DUMPING: "1" },
  });
  let killed = false;
  const kill = () => {
    if (killed) return;
    killed = true;
    proc.kill("SIGKILL");
  };
  const timer = setTimeout(kill, timeoutMs);
  const lines: string[] = [];
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of proc.stdout) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trimEnd();
      buffer = buffer.slice(newline + 1);
      lines.push(line);
      if (!killed) onLine(line, kill);
      newline = buffer.indexOf("\n");
    }
  }
  const exitCode = await proc.exited;
  clearTimeout(timer);
  const stderr = await new Response(proc.stderr).text();
  for (let i = 0; i < 50 && !pidGone(proc.pid); i += 1) await Bun.sleep(100);
  if (!pidGone(proc.pid)) throw new Error(`pid ${proc.pid} still running`);
  return { lines, exitCode, stderr, pid: proc.pid, killed };
}

// ── contract: the engine DocStore cases inside the Electron worker ──────

async function caseContract(): Promise<CaseResult> {
  const run = await runHarness(["--mode=contract"], () => {}, 300_000);
  const count = (prefix: string) =>
    run.lines.filter((l) => l.startsWith(`${prefix} `)).length;
  const ok = count("CASE_OK");
  // P2.7b's LibraryIndex contract through RpcLibraryIndex (P2.6e).
  const libraryOk = count("LIBRARY_CASE_OK");
  const failed = run.lines.filter(
    (l) => l.startsWith("CASE_FAIL") || l.startsWith("LIBRARY_CASE_FAIL"),
  );
  return {
    name: "contract",
    pass: run.exitCode === 0 && failed.length === 0 && ok > 0 && libraryOk > 0,
    summary: `on node:sqlite in the Electron worker: P2.1's DocStore contract ${ok} cases passed; P2.7b's LibraryIndex contract (RpcLibraryIndex) ${libraryOk} cases passed`,
    details: { ok, libraryOk, exitCode: run.exitCode },
    failures: [
      ...failed,
      ...(run.exitCode === 0 ? [] : [run.stderr.slice(0, 2000)]),
    ],
  };
}

// ── T1, T2, T3 control: kill during append or compaction ───────────────

type KillTarget = "append" | "compaction";

async function killLoop(
  name: string,
  target: KillTarget,
  kills: number,
  options: { dense?: boolean; synchronous?: "FULL" | "OFF" } = {},
): Promise<CaseResult> {
  const dir = mkdtempSync(join(tmpdir(), `soak-${name}-`));
  const padBytes = target === "compaction" ? 5 * 1024 * 1024 : 64 * 1024;
  const docId = seedLibrary(dir, padBytes);
  const random = seededRandom(kills * 7919 + target.length);
  const failures: string[] = [];
  let inside = 0;
  let afterFirstAck = 0;
  let maxK = 0;
  for (let i = 1; i <= kills; i += 1) {
    let ackSeq = 0;
    let ackedK = 0;
    let last = "";
    let sawAck = false;
    const delay = target === "append" ? 50 + random() * 1950 : random() * 20;
    const run = await runHarness(
      [
        "--mode=churn",
        `--dir=${dir}`,
        `--doc=${docId}`,
        `--seed=${i}`,
        `--target=${target}`,
        `--synchronous=${options.synchronous ?? "FULL"}`,
        ...(options.dense ? ["--dense"] : []),
      ],
      (line, kill) => {
        const [word, a, b] = line.split(" ");
        if (word === "ACK") {
          ackSeq = Math.max(ackSeq, Number(a));
          sawAck = true;
        } else if (word === "EDITS") ackedK = Math.max(ackedK, Number(b));
        if (/^(BATCH_BEGIN|ACK|COMPACT_BEGIN|COMPACT_ACK)$/.test(word ?? ""))
          last = word ?? "";
        if (target === "append" && word === "READY") setTimeout(kill, delay);
        if (target === "compaction" && word === "COMPACT_BEGIN")
          setTimeout(kill, delay);
        if (target === "compaction" && word === "READY")
          setTimeout(kill, 15_000); // never compacted: still kill
      },
      60_000,
    );
    if (!run.killed) {
      failures.push(
        `kill ${i}: exited by itself (${run.exitCode}) ${run.stderr.slice(0, 500)}`,
      );
      continue;
    }
    if (last === "BATCH_BEGIN" || last === "COMPACT_BEGIN") inside += 1;
    if (sawAck) afterFirstAck += 1;
    try {
      const library = openEngine(dir);
      const { status } = library;
      if (status.quickCheck !== null && status.quickCheck !== "ok")
        failures.push(`kill ${i}: quick_check ${status.quickCheck}`);
      const stored = textOf(library, docId);
      library.shutdown();
      const k = editCount(stored.text);
      if (k === null) failures.push(`kill ${i}: text has a gap or a torn edit`);
      else {
        maxK = k;
        if (k < ackedK)
          failures.push(`kill ${i}: lost acked edits (${k} < ${ackedK})`);
      }
      if (stored.maxSeq < ackSeq)
        failures.push(
          `kill ${i}: lost acked seq (${stored.maxSeq} < ${ackSeq})`,
        );
      if (stored.padLength !== padBytes)
        failures.push(`kill ${i}: pad is ${stored.padLength}, not ${padBytes}`);
    } catch (error) {
      failures.push(`kill ${i}: reopen failed: ${String(error)}`);
    }
    note(
      `${name} ${i}/${kills} last=${last} acked=${ackedK} failures=${failures.length}`,
    );
  }
  removeDir(dir);
  return {
    name,
    pass: failures.length === 0,
    summary: `${kills} kills, ${afterFirstAck} after the first ack, ${inside} inside a transaction; ${failures.length} failures; final K ${maxK}`,
    details: { kills, afterFirstAck, inside, maxK, target, ...options },
    failures: failures.slice(0, 50),
  };
}

// ── T3: fullfsync on vs off, plus the synchronous=OFF control ─────────

async function caseT3(): Promise<CaseResult> {
  const failures: string[] = [];
  const timings: Record<string, unknown>[] = [];
  for (const fullfsync of ["1", "0"]) {
    const dir = mkdtempSync(join(tmpdir(), "soak-t3-"));
    const run = await runHarness([
      "--mode=commit-timing",
      `--dir=${dir}`,
      `--fullfsync=${fullfsync}`,
      "--count=300",
    ]);
    removeDir(dir);
    const line = run.lines.find((l) => l.startsWith("TIMING "));
    if (!line) {
      failures.push(
        `timing fullfsync=${fullfsync}: ${run.stderr.slice(0, 500)}`,
      );
      continue;
    }
    const timing = JSON.parse(line.slice(7)) as {
      pragmas: Record<string, unknown>;
    } & Record<string, unknown>;
    timings.push(timing);
    const expectedFull =
      process.platform === "darwin" && fullfsync === "1" ? 1 : 0;
    if (timing.pragmas.journalMode !== "wal")
      failures.push(`journal_mode ${timing.pragmas.journalMode}`);
    if (timing.pragmas.synchronous !== 2)
      failures.push(`synchronous ${timing.pragmas.synchronous}`);
    if (
      process.platform === "darwin" &&
      timing.pragmas.fullfsync !== expectedFull
    )
      failures.push(
        `fullfsync ${timing.pragmas.fullfsync}, wanted ${expectedFull}`,
      );
  }
  const control = await killLoop("T3-control", "append", Math.min(KILLS, 50), {
    synchronous: "OFF",
  });
  failures.push(...control.failures);
  return {
    name: "T3",
    pass: failures.length === 0,
    summary: `pragmas read back as set; commit p50 ${timings
      .map(
        (t) =>
          `${Number(t.p50).toFixed(2)} ms (fullfsync ${t.fullfsync ? "on" : "off"})`,
      )
      .join(
        " vs ",
      )}; synchronous=OFF control: ${control.summary}. Power loss itself needs owner hardware.`,
    details: { timings, control: control.details },
    failures,
  };
}

// ── T4: quit with writes in flight ─────────────────────────────────────

async function caseT4(runs: number): Promise<CaseResult> {
  const dir = mkdtempSync(join(tmpdir(), "soak-t4-"));
  const docId = seedLibrary(dir, 64 * 1024);
  const random = seededRandom(4);
  const failures: string[] = [];
  let clean = 0;
  for (let i = 1; i <= runs; i += 1) {
    const quitAfter = Math.round(300 + random() * 2700);
    const run = await runHarness([
      "--mode=churn",
      `--dir=${dir}`,
      `--doc=${docId}`,
      `--seed=${100 + i}`,
      `--quit-after-ms=${quitAfter}`,
    ]);
    const quit = run.lines.find((l) => l.startsWith("QUIT "));
    if (run.exitCode !== 0 || !quit) {
      failures.push(
        `run ${i}: exit ${run.exitCode} ${run.stderr.slice(0, 500)}`,
      );
      continue;
    }
    const [, outcome, kText] = quit.split(" ");
    if (outcome === "clean") clean += 1;
    else failures.push(`run ${i}: shutdown ${outcome}`);
    if (existsSync(join(dir, LOCK_FILE)))
      failures.push(`run ${i}: lock left behind`);
    const wal = join(dir, `${LIBRARY_FILE}-wal`);
    if (existsSync(wal) && statSync(wal).size > 0)
      failures.push(`run ${i}: WAL not checkpointed (${statSync(wal).size} B)`);
    const library = openEngine(dir);
    if (library.status.uncleanExit)
      failures.push(`run ${i}: unclean_exit still set`);
    const k = editCount(textOf(library, docId).text);
    library.shutdown();
    if (k !== Number(kText))
      failures.push(`run ${i}: ${k} edits stored, ${kText} typed before quit`);
  }
  removeDir(dir);
  return {
    name: "T4",
    pass: failures.length === 0,
    summary: `${runs} quits with edits in flight: ${clean} clean shutdowns, every typed edit stored`,
    details: { runs, clean },
    failures,
  };
}

// ── T5: migration interrupted ──────────────────────────────────────────

function stepTables(dir: string) {
  const db = new Database(join(dir, LIBRARY_FILE));
  const counts: Record<number, number> = {};
  for (const step of T5_STEPS) {
    const exists = db
      .query("SELECT 1 FROM sqlite_master WHERE name = ?")
      .get(`soak_step_${step.to}`);
    if (exists)
      counts[step.to] = (
        db.query(`SELECT COUNT(*) AS n FROM soak_step_${step.to}`).get() as {
          n: number;
        }
      ).n;
  }
  const check = (
    db.query("PRAGMA quick_check").get() as { quick_check: string }
  ).quick_check;
  db.close();
  return { counts, check };
}

async function caseT5(kills: number): Promise<CaseResult> {
  const failures: string[] = [];
  const reached: Record<number, number> = {};
  // Calibrate: how long a full migration takes on this runner.
  const calibrationDir = mkdtempSync(join(tmpdir(), "soak-t5-"));
  seedLibrary(calibrationDir, 0);
  const t0 = performance.now();
  const calibration = await runHarness([
    "--mode=migrate",
    `--dir=${calibrationDir}`,
  ]);
  const fullMs = performance.now() - t0;
  if (!calibration.lines.some((l) => l === `MIGRATED ${T5_TARGET} null`))
    failures.push(
      `calibration: ${calibration.lines.join(" | ")} ${calibration.stderr.slice(0, 500)}`,
    );
  removeDir(calibrationDir);
  const random = seededRandom(5);
  for (let i = 1; i <= kills; i += 1) {
    const dir = mkdtempSync(join(tmpdir(), "soak-t5-"));
    const docId = seedLibrary(dir, 4096);
    const delay = random() * fullMs;
    await runHarness(["--mode=migrate", `--dir=${dir}`], (line, kill) => {
      if (line === "READY") setTimeout(kill, delay);
    });
    // As an app at format 1 sees it: a newer library opens read-only.
    const probe = openEngine(dir);
    const version = probe.status.formatVersion;
    probe.shutdown();
    reached[version] = (reached[version] ?? 0) + 1;
    const { counts, check } = stepTables(dir);
    if (check !== "ok") failures.push(`kill ${i}: quick_check ${check}`);
    for (const step of T5_STEPS) {
      const rows = counts[step.to];
      if (step.to <= version && rows !== STEP_ROWS)
        failures.push(
          `kill ${i}: v${version} but step ${step.to} has ${rows} rows`,
        );
      if (step.to > version && rows !== undefined)
        failures.push(
          `kill ${i}: v${version} but step ${step.to}'s table exists`,
        );
    }
    // The migrating app finishes the job.
    const library = openEngine(dir, {
      formatVersion: T5_TARGET,
      formatSteps: T5_STEPS,
    });
    if (library.status.formatVersion !== T5_TARGET || library.status.readOnly)
      failures.push(
        `kill ${i}: resume reached v${library.status.formatVersion} ${library.status.readOnly}`,
      );
    const pad = textOf(library, docId).padLength;
    library.shutdown();
    if (pad !== 4096) failures.push(`kill ${i}: document damaged (${pad})`);
    removeDir(dir);
  }
  return {
    name: "T5",
    pass: failures.length === 0,
    summary: `${kills} kills during a 3-step migration (${Math.round(fullMs)} ms); stopped at v2–v5: ${JSON.stringify(reached)}; each step all-or-nothing, every resume reached v${T5_TARGET}`,
    details: { kills, fullMs, reached },
    failures,
  };
}

// ── T6: a newer library is read-only ───────────────────────────────────

async function caseT6(): Promise<CaseResult> {
  const dir = mkdtempSync(join(tmpdir(), "soak-t6-"));
  seedLibrary(dir, 1024);
  const db = new Database(join(dir, LIBRARY_FILE));
  db.exec("UPDATE meta SET value = '9' WHERE key = 'format_version'");
  db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  db.close();
  const hash = () =>
    createHash("sha256")
      .update(readFileSync(join(dir, LIBRARY_FILE)))
      .digest("hex");
  const before = hash();
  const run = await runHarness(["--mode=readonly", `--dir=${dir}`]);
  const after = hash();
  removeDir(dir);
  const failures: string[] = [];
  const status = run.lines.find((l) => l.startsWith("STATUS "));
  if (!status || JSON.parse(status.slice(7)).readOnly !== "library_too_new")
    failures.push(`status: ${status}`);
  if (!run.lines.includes("WRITE refused library_too_new"))
    failures.push(`write: ${run.lines.find((l) => l.startsWith("WRITE"))}`);
  if (!run.lines.includes("SIDEBAR 1"))
    failures.push("the newer library's list didn't load");
  if (before !== after) failures.push("library.sqlite changed");
  if (run.exitCode !== 0)
    failures.push(`exit ${run.exitCode} ${run.stderr.slice(0, 500)}`);
  return {
    name: "T6",
    pass: failures.length === 0,
    summary:
      "a format-9 library opened read-only in the Electron worker: list shown, writes refused, file byte-identical",
    details: { before, after },
    failures,
  };
}

// ── T8: a year of editing, then startup with 1,000 documents ──────────

/**
 * Architecture §10 targets, from process start: "Worker ready" and
 * "Sidebar populated" (Mac means an M1, Win a mid-range laptop; Linux uses
 * the Windows row). CI applies §10's 1.5× slack to the sidebar gate.
 */
function budgets() {
  return process.platform === "darwin"
    ? { workerReadyMs: 150, sidebarMs: 600 }
    : { workerReadyMs: 300, sidebarMs: 1000 };
}

async function caseT8(): Promise<CaseResult> {
  const docs = Number(args.docs ?? 1000);
  const docBytes = Number(args["doc-bytes"] ?? 200 * 1024);
  const days = Number(args.days ?? 365);
  const dir = mkdtempSync(join(tmpdir(), "soak-t8-"));
  const failures: string[] = [];
  const clock = { now: Date.UTC(2026, 0, 1, 9) };
  const host = createNodeHost({ now: () => clock.now });
  const open = () =>
    Library.open({ dir, host, openSqlite: openBunSqlite, fullfsync: false });
  let library = open();
  const random = seededRandom(8);
  const started = performance.now();

  // Seed: 1,000 documents of about 200 KB in 30 folders, with tags.
  const folders = Array.from(
    { length: 30 },
    (_, i) => library.createFolder({ name: `Folder ${i}` })?.id ?? null,
  );
  const tags = Array.from(
    { length: 20 },
    (_, i) => library.createTag(`tag-${i}`)?.id ?? "",
  );
  const template = new Y.Doc();
  template.getText(PAD).insert(0, "p".repeat(docBytes));
  const templateState = Y.encodeStateAsUpdate(template);
  const ids: string[] = [];
  const createSeeded = () => {
    const { id } = library.createDoc({
      title: `Document ${ids.length}`,
      folderId: folders[Math.floor(random() * folders.length)] ?? null,
    });
    library.load(id, "seed");
    library.compact(id, "seed", templateState, 0);
    library.close(id, "seed");
    const picked = tags.filter(() => random() < 0.08);
    if (picked.length) library.setDocTags(id, picked);
    ids.push(id);
    return id;
  };
  for (let i = 0; i < docs; i += 1) createSeeded();
  const seededBytes = library.stats().bytes;

  // References for a few documents, checked at the end.
  const watched = new Map<string, string>(
    ids.slice(0, 5).map((id) => [id, ""]),
  );
  const monthly: Record<string, unknown>[] = [];
  // How long each daily VACUUM INTO blocked the worker: a quit flush queues
  // behind it (D-A2's "a clean quit loses nothing" needs it under ~3 s).
  const copyMs: number[] = [];
  let appends = 0;
  let compactions = 0;
  let trashed = 0;

  for (let day = 0; day < days; day += 1) {
    const today = new Set<string>(
      [...watched.keys()].filter(() => random() < 0.3),
    );
    while (today.size < 20)
      today.add(ids[Math.floor(random() * ids.length)] as string);
    for (const id of today) {
      // An editing session: hydrate, type in batches, compact on close.
      const loaded = library.load(id, "w");
      const doc = new Y.Doc();
      if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot);
      for (const u of loaded.updates) Y.applyUpdate(doc, u);
      let acked = loaded.maxSeq;
      let rowsSinceSnapshot = loaded.updates.length;
      const batches = 10 + Math.floor(random() * 30);
      for (let b = 0; b < batches; b += 1) {
        let update: Uint8Array = new Uint8Array();
        doc.once("update", (u: Uint8Array) => {
          update = u;
        });
        const words = `w${day}-${b} `.repeat(30);
        doc.getText(TEXT).insert(doc.getText(TEXT).length, words);
        acked = library.append(id, "w", {
          origin: "local",
          update,
          title: `Document ${id.slice(0, 4)}`,
          // A list-view snippet as long as the real one, so the sidebar
          // payload is realistic.
          snippet: words.repeat(2).slice(0, 200),
        });
        appends += 1;
        rowsSinceSnapshot += 1;
        clock.now += 1000;
        if (rowsSinceSnapshot > 500) {
          library.compact(id, "w", Y.encodeStateAsUpdate(doc), acked);
          compactions += 1;
          rowsSinceSnapshot = 0;
        }
      }
      library.compact(id, "w", Y.encodeStateAsUpdate(doc), acked);
      compactions += 1;
      library.close(id, "w");
      if (watched.has(id)) watched.set(id, doc.getText(TEXT).toString());
    }
    // One new document a day, and one old one trashed (purged after 30 days).
    createSeeded();
    const victim = ids.splice(
      5 + Math.floor(random() * (ids.length - 6)),
      1,
    )[0];
    if (victim) {
      library.trashDoc(victim);
      trashed += 1;
    }
    // Idle: the daily copy and the Trash purge.
    clock.now += IDLE_MS;
    const idle = await library.runIdleJobs();
    if (idle.dailyCopyMs !== null) copyMs.push(idle.dailyCopyMs);
    if (idle.dailyCopy === null && idle.dailyCopyMs !== null)
      failures.push(
        `day ${day}: daily copy failed (${library.stats().lastDailyCopyError})`,
      );
    // Restart now and then, sometimes uncleanly.
    if (day % 30 === 29) {
      if (random() < 0.5) library.shutdown();
      else (library as unknown as { db: { close(): void } }).db.close();
      library = open();
      if (
        library.status.quickCheck !== null &&
        library.status.quickCheck !== "ok"
      )
        failures.push(`day ${day}: quick_check ${library.status.quickCheck}`);
    }
    if (day % 30 === 0 || day === days - 1) {
      const stats = library.stats();
      monthly.push({
        day,
        mb: +(stats.bytes / 1048576).toFixed(1),
        docs: stats.docs,
        pendingRows: stats.pendingRows,
        dailyCopies: library.listDailyCopies().length,
      });
    }
    clock.now = Date.UTC(2026, 0, 2 + day, 9);
  }

  const stats = library.stats();
  const dailies = library.listDailyCopies();
  if (dailies.length !== Math.min(DAILY_KEEP, days))
    failures.push(`${dailies.length} daily copies kept, wanted ${DAILY_KEEP}`);
  if (stats.pendingRows !== 0)
    failures.push(`${stats.pendingRows} rows left uncompacted`);
  for (const [id, expected] of watched) {
    if (!ids.includes(id)) continue;
    const { text } = textOf(library, id);
    if (text !== expected) failures.push(`watched document ${id} lost text`);
  }
  // Growth: the year's text is small next to the seed; the library must not
  // keep history it no longer needs.
  const growth = stats.bytes / seededBytes;
  if (growth > 1.5)
    failures.push(`library grew ${growth.toFixed(2)}× in a year`);
  const liveDocs = library.sidebar().docs.length;
  library.shutdown();
  const simMs = performance.now() - started;

  // Startup with the year-end library: worker ready and sidebar rows.
  // `--no-electron` checks the simulation alone (local runs).
  const startups: Record<string, number>[] = [];
  for (let i = 0; i < (args["no-electron"] ? 0 : 5); i += 1) {
    const run = await runHarness(["--mode=startup", `--dir=${dir}`]);
    const line = run.lines.find((l) => l.startsWith("STARTUP "));
    if (!line) {
      failures.push(`startup ${i}: ${run.stderr.slice(0, 500)}`);
      continue;
    }
    startups.push(JSON.parse(line.slice(8)));
  }
  const budget = budgets();
  const median = (key: string) => {
    const values = startups.map((s) => Number(s[key])).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)] ?? Number.NaN;
  };
  const toSidebar = median("processToSidebarMs");
  const toWorkerReady = median("processToReadyMs");
  if (!args["no-electron"] && !(toSidebar <= budget.sidebarMs * 1.5))
    failures.push(
      `sidebar rows ${toSidebar.toFixed(0)} ms after process start, budget ${budget.sidebarMs} ms (× 1.5 CI slack)`,
    );
  if (startups.some((s) => s.docs !== liveDocs))
    failures.push(
      `startup listed ${startups.map((s) => s.docs)} documents, wanted ${liveDocs}`,
    );
  // §10 "After an unclean exit": quick_check runs inside the open.
  let unclean: Record<string, number> | null = null;
  if (!args["no-electron"]) {
    const db = new Database(join(dir, LIBRARY_FILE));
    db.exec("UPDATE meta SET value = '1' WHERE key = 'unclean_exit'");
    db.close();
    const run = await runHarness(["--mode=startup", `--dir=${dir}`]);
    const line = run.lines.find((l) => l.startsWith("STARTUP "));
    if (line) unclean = JSON.parse(line.slice(8));
    if (!unclean?.uncleanExit)
      failures.push(`unclean startup: ${line ?? run.stderr.slice(0, 500)}`);
    else if (unclean.openMs > 2000)
      failures.push(
        `quick_check open took ${unclean.openMs.toFixed(0)} ms, budget 2 s`,
      );
  }
  const sortedCopies = [...copyMs].sort((a, b) => a - b);
  const copyMedian = sortedCopies[Math.floor(sortedCopies.length / 2)] ?? 0;
  const copyMax = sortedCopies.at(-1) ?? 0;
  // Decision 5: the batched copy in its thread on node:sqlite, against
  // VACUUM INTO on the same year-end library.
  const comparison = args["no-electron"] ? null : await compareCopies(dir);
  if (comparison?.error) failures.push(`batched copy: ${comparison.error}`);
  removeDir(dir);
  return {
    name: "T8",
    pass: failures.length === 0,
    summary: `${days} days, ${appends} appends, ${compactions} compactions, ${trashed} trashed; ${(seededBytes / 1048576).toFixed(0)} → ${(stats.bytes / 1048576).toFixed(0)} MB; ${dailies.length} daily copies (bun inline median ${copyMedian.toFixed(0)} ms, max ${copyMax.toFixed(0)} ms)${comparison ? `; batched copy on node:sqlite ${comparison.batchedMs?.toFixed(0)} ms, ${(comparison.batchedBytes / 1048576).toFixed(1)} MB vs VACUUM INTO ${comparison.vacuumMs.toFixed(0)} ms, ${(comparison.vacuumBytes / 1048576).toFixed(1)} MB` : ""}; ${liveDocs} documents: worker ready ${toWorkerReady.toFixed(0)} ms and sidebar rows ${toSidebar.toFixed(0)} ms after process start (median of 5; §10 ${budget.workerReadyMs} / ${budget.sidebarMs} ms; excludes renderer IPC and paint); unclean-exit open with quick_check ${unclean ? unclean.openMs.toFixed(0) : "n/a"} ms`,
    details: {
      days,
      docs: liveDocs,
      appends,
      compactions,
      trashed,
      seededBytes,
      finalBytes: stats.bytes,
      monthly,
      startups,
      unclean,
      budget,
      dailyCopyMs: { median: copyMedian, max: copyMax, count: copyMs.length },
      comparison,
      simMs,
    },
    failures,
  };
}

/** Batched copy (Electron, its thread) vs VACUUM INTO (bun), same library. */
async function compareCopies(dir: string) {
  const daily = join(dir, "daily");
  // The year's copies are dated ahead of today's real clock: today's copy
  // would sort oldest and be pruned at once, so start from an empty folder.
  removeDir(daily);
  const before = new Set<string>();
  const run = await runHarness(["--mode=copy-time", `--dir=${dir}`]);
  const line = run.lines.find((l) => l.startsWith("COPYTIME "));
  if (!line)
    return {
      error: run.stderr.slice(0, 500),
      batchedMs: null,
      batchedBytes: 0,
      vacuumMs: 0,
      vacuumBytes: 0,
    };
  const timing = JSON.parse(line.slice(9)) as {
    ms: number | null;
    error: string | null;
  };
  const made = createNodeHost()
    .list(daily)
    .find((file) => !before.has(file) && file.endsWith(".sqlite"));
  const batchedBytes = made ? statSync(join(daily, made)).size : 0;
  const vacuumPath = join(dir, "vacuum-into.sqlite");
  // Read-write: a read-only open of a WAL file with no -shm can't start.
  const db = new Database(join(dir, LIBRARY_FILE));
  const t0 = performance.now();
  db.prepare("VACUUM INTO ?").run(vacuumPath);
  const vacuumMs = performance.now() - t0;
  db.close();
  return {
    error: timing.error ?? (made ? null : "no copy file"),
    batchedMs: timing.ms,
    batchedBytes,
    vacuumMs,
    vacuumBytes: statSync(vacuumPath).size,
  };
}

// ── T4-copy: quit while the daily copy runs (decision 5) ──────────────

function yesterday(): string {
  const date = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function caseQuitDuringCopy(runs: number): Promise<CaseResult> {
  const dir = mkdtempSync(join(tmpdir(), "soak-t4c-"));
  const docs = Number(args["copy-docs"] ?? 1000);
  const failures: string[] = [];
  // A library big enough that the copy outlasts the typing: ~200 MB.
  const library = openEngine(dir);
  const pad = new Y.Doc();
  pad.getText(PAD).insert(0, "p".repeat(200 * 1024));
  const padState = Y.encodeStateAsUpdate(pad);
  for (let i = 0; i < docs; i += 1) {
    const { id } = library.createDoc({ title: `Doc ${i}` });
    library.load(id, "seed");
    library.compact(id, "seed", padState, 0);
    library.close(id, "seed");
  }
  const { id: docId } = library.createDoc({ title: "Typed" });
  // The previous good copy, dated yesterday: it must survive every quit.
  const previous = await library.takeDailyCopyNow();
  const copyError = library.stats().lastDailyCopyError;
  library.shutdown();
  if (!previous) throw new Error(`setup copy failed: ${copyError}`);
  const daily = join(dir, "daily");
  const previousPath = join(daily, `library-${yesterday()}.sqlite`);
  renameSync(join(daily, previous), previousPath);
  const resetDay = () => {
    const db = new Database(join(dir, LIBRARY_FILE));
    db.prepare("UPDATE meta SET value = ? WHERE key = 'last_daily_copy'").run(
      yesterday(),
    );
    db.close();
  };
  resetDay();
  const hashOf = (path: string) =>
    createHash("sha256").update(readFileSync(path)).digest("hex");
  const previousHash = hashOf(previousPath);
  let midCopy = 0;
  // How each running copy was stopped: "answered" (it closed its own files),
  // or a terminate() fallback; and whether the partial was then deleted.
  const stops: Record<string, number> = {};
  const quitMs: number[] = [];
  const exitLagMs: number[] = [];
  const appendMaxMs: number[] = [];
  for (let i = 1; i <= runs; i += 1) {
    let quitSeenAt = 0;
    let began = false;
    let done = false;
    const run = await runHarness(
      ["--mode=copy-quit", `--dir=${dir}`, `--doc=${docId}`],
      (line) => {
        if (line.startsWith("COPY_BEGIN")) began = true;
        if (line.startsWith("COPY_STOPPED ")) {
          const [, outcome, , removed] = line.split(" ");
          const key = `${outcome}/${removed}`;
          stops[key] = (stops[key] ?? 0) + 1;
          if (removed !== "removed")
            failures.push(`run ${i}: the partial copy was not deleted at quit`);
        }
        if (line.startsWith("COPY_DONE")) done = true;
        if (line.startsWith("QUIT ")) quitSeenAt = performance.now();
      },
    );
    const exitedAt = performance.now();
    note(run.lines.filter((l) => !/^(BATCH_BEGIN|ACK)/.test(l)).join(" | "));
    const quit = run.lines.find((l) => l.startsWith("QUIT "));
    if (run.exitCode !== 0 || !quit) {
      failures.push(
        `run ${i}: exit ${run.exitCode} ${run.stderr.slice(0, 500)}`,
      );
      continue;
    }
    const [, outcome, kText, quitText, appendText] = quit.split(" ");
    if (began && !done) midCopy += 1;
    quitMs.push(Number(quitText));
    appendMaxMs.push(Number(appendText));
    exitLagMs.push(exitedAt - quitSeenAt);
    if (outcome !== "clean") failures.push(`run ${i}: shutdown ${outcome}`);
    if (Number(quitText) > 2000)
      failures.push(`run ${i}: shutdown took ${quitText} ms (budget 2 s)`);
    const partials = createNodeHost()
      .list(daily)
      .filter((file) => file.endsWith(".partial"));
    if (partials.length > 0)
      failures.push(
        `run ${i}: partial copy left behind: ${partials.join(", ")}`,
      );
    if (!existsSync(previousPath) || hashOf(previousPath) !== previousHash)
      failures.push(`run ${i}: the previous good copy changed`);
    const reopened = openEngine(dir);
    if (reopened.status.uncleanExit)
      failures.push(`run ${i}: unclean_exit set`);
    const k = editCount(textOf(reopened, docId).text);
    reopened.shutdown();
    if (k !== Number(kText))
      failures.push(`run ${i}: ${k} edits stored, ${kText} typed before quit`);
    // A run whose copy finished leaves today's copy: undo it for the next run.
    for (const file of createNodeHost().list(daily))
      if (file.endsWith(".sqlite") && join(daily, file) !== previousPath)
        removeDir(join(daily, file));
    resetDay();
  }
  removeDir(dir);
  const max = (values: number[]) => Math.round(Math.max(0, ...values));
  if (midCopy === 0) failures.push("no quit landed during a copy");
  if (midCopy < runs)
    failures.push(`${runs - midCopy} of ${runs} quits missed the copy`);
  return {
    name: "T4-copy",
    pass: failures.length === 0,
    summary: `${runs} quits, ${midCopy} during a daily copy (stops: ${JSON.stringify(stops)}): every typed edit stored, clean shutdowns (max ${max(quitMs)} ms), process gone ${max(exitLagMs)} ms after the quit at worst, no partial copy left, the previous copy byte-identical; slowest append during a copy ${max(appendMaxMs)} ms`,
    details: { runs, midCopy, stops, quitMs, exitLagMs, appendMaxMs },
    failures,
  };
}

// ── T24: the 1→2 migration on a 200 MB library (offline revision §5.3) ──

function invariantAt(dir: string): string {
  const driver = openBunSqlite(join(dir, LIBRARY_FILE), { readOnly: false });
  try {
    return updatesInvariant(driver, createNodeHost());
  } finally {
    driver.close();
  }
}

/** Format, a v2-only column, and foreign_key_check, read straight from the file. */
function fileFormat(dir: string) {
  const db = new Database(join(dir, LIBRARY_FILE));
  const version = (
    db.query("SELECT value FROM meta WHERE key = 'format_version'").get() as {
      value: string;
    }
  ).value;
  const v2 =
    db
      .query("SELECT 1 FROM pragma_table_info('docs') WHERE name = 'head_seq'")
      .get() !== null;
  const fk = db.query("PRAGMA foreign_key_check").all().length;
  db.close();
  return { version, v2, fk };
}

async function caseT24(): Promise<CaseResult> {
  const docs = Number(args["t24-docs"] ?? 1000);
  const dir = mkdtempSync(join(tmpdir(), "soak-t24-"));
  const failures: string[] = [];
  writeFormat1Library(dir, {
    docs,
    docBytes: 200 * 1024,
    folders: 30,
    rowsPerDoc: 5,
  });
  const before = invariantAt(dir);
  const bytes = statSync(join(dir, LIBRARY_FILE)).size;
  const run = await runHarness(
    ["--mode=migrate-v2", `--dir=${dir}`],
    () => {},
    300_000,
  );
  const line = run.lines.find((l) => l.startsWith("MIGRATED_V2 "));
  const result = line ? JSON.parse(line.slice(12)) : null;
  if (!result) failures.push(`no result: ${run.stderr.slice(0, 500)}`);
  else {
    if (result.formatVersion !== 2 || result.readOnly)
      failures.push(`ended at v${result.formatVersion} ${result.readOnly}`);
    if (result.foreignKeys !== 1)
      failures.push("foreign_keys is off after the step");
  }
  const after = fileFormat(dir);
  if (!after.v2 || after.version !== "2")
    failures.push("the file isn't format 2");
  if (after.fk > 0) failures.push(`${after.fk} foreign_key_check rows`);
  if (invariantAt(dir) !== before)
    failures.push("the updates invariant changed");
  const backups = createNodeHost()
    .list(dir)
    .filter((f) => f.startsWith("library.pre-v1-"));
  if (backups.length !== 1) failures.push(`${backups.length} backups`);
  const wal = join(dir, `${LIBRARY_FILE}-wal`);
  const walBytes = existsSync(wal) ? statSync(wal).size : 0;
  const budget =
    process.platform === "darwin" ? 10_000 : Number.POSITIVE_INFINITY;
  if (result && result.ms > budget * 1.5)
    failures.push(
      `took ${Math.round(result.ms)} ms, budget ${budget} ms (× 1.5)`,
    );
  removeDir(dir);
  return {
    name: "T24",
    pass: failures.length === 0,
    summary: `${docs} documents, ${(bytes / 1048576).toFixed(0)} MB: 1→2 in ${result ? Math.round(result.ms) : "?"} ms on node:sqlite (Mac budget 10 s; Windows reported); one backup; updates invariant equal; foreign_key_check clean; WAL ${walBytes} B after`,
    details: { docs, bytes, result, walBytes },
    failures,
  };
}

// ── T24b: a kill at every statement boundary of the step ──────────────

async function caseT24b(): Promise<CaseResult> {
  const failures: string[] = [];
  const seed = (dir: string) =>
    writeFormat1Library(dir, { docs: 60, docBytes: 2048 });
  // Calibrate: how many boundaries one clean run passes.
  const calibration = mkdtempSync(join(tmpdir(), "soak-t24b-"));
  seed(calibration);
  const clean = await runHarness(["--mode=migrate-v2", `--dir=${calibration}`]);
  const boundaries = clean.lines.filter((l) =>
    l.startsWith("BOUNDARY "),
  ).length;
  removeDir(calibration);
  if (boundaries === 0)
    failures.push(`calibration: ${clean.stderr.slice(0, 500)}`);
  const outcomes: Record<string, number> = {};
  for (let k = 1; k <= boundaries; k += 1) {
    const dir = mkdtempSync(join(tmpdir(), "soak-t24b-"));
    seed(dir);
    const before = invariantAt(dir);
    const run = await runHarness([
      "--mode=migrate-v2",
      `--dir=${dir}`,
      `--kill-at=${k}`,
    ]);
    const name =
      run.lines.filter((l) => l.startsWith("BOUNDARY ")).at(-1) ?? "none";
    const state = fileFormat(dir);
    const shape =
      state.version === "1" && !state.v2
        ? "v1"
        : state.version === "2" && state.v2
          ? "v2"
          : "mixed";
    outcomes[shape] = (outcomes[shape] ?? 0) + 1;
    if (shape === "mixed")
      failures.push(
        `kill at ${name}: format ${state.version}, v2 columns ${state.v2}`,
      );
    if (state.fk > 0)
      failures.push(`kill at ${name}: ${state.fk} foreign_key_check rows`);
    if (invariantAt(dir) !== before)
      failures.push(`kill at ${name}: updates changed`);
    // The next open finishes the job.
    const library = openEngine(dir);
    if (library.status.formatVersion !== 2 || library.status.readOnly)
      failures.push(
        `kill at ${name}: reopen reached v${library.status.formatVersion} ${library.status.readOnly}`,
      );
    const text = textOf(library, v1DocId(5)).padLength;
    void text;
    library.shutdown();
    if (invariantAt(dir) !== before)
      failures.push(`kill at ${name}: updates changed after the reopen`);
    removeDir(dir);
  }
  // A v1 file with seeded orphans is refused, and nothing is written.
  const orphans = mkdtempSync(join(tmpdir(), "soak-t24b-"));
  seed(orphans);
  const db = new Database(join(orphans, LIBRARY_FILE));
  db.exec("UPDATE docs SET folder_id = 'missing' WHERE rowid IN (1, 2)");
  db.close();
  const refused = await runHarness(["--mode=migrate-v2", `--dir=${orphans}`]);
  const refusedLine =
    refused.lines.find((l) => l.startsWith("MIGRATED_V2 ")) ?? "";
  if (!refusedLine.includes('"readOnly":"migration_failed"'))
    failures.push(`orphans: ${refusedLine || refused.stderr.slice(0, 300)}`);
  if (fileFormat(orphans).v2) failures.push("orphans: the step wrote anyway");
  removeDir(orphans);
  return {
    name: "T24b",
    pass: failures.length === 0,
    summary: `killed at each of ${boundaries} statement boundaries: left v1 intact ${outcomes.v1 ?? 0}×, v2 complete ${outcomes.v2 ?? 0}×, mixed ${outcomes.mixed ?? 0}×; every reopen finished the step with the updates invariant equal; a v1 file with orphans was refused by preflight with nothing written`,
    details: { boundaries, outcomes },
    failures,
  };
}

// ── T23: write amplification over a year on a long document ──────────

/** A long document: `headings` sections of paragraphs, real Yjs items. */
function buildLongDoc(headings: number, paragraphBytes: number): Y.Doc {
  const doc = new Y.Doc();
  const fragment = doc.getXmlFragment("default");
  const blocks: Y.XmlElement[] = [];
  for (let h = 0; h < headings; h += 1) {
    const heading = new Y.XmlElement("heading");
    heading.setAttribute("level", String(1 + (h % 3)));
    heading.setAttribute("data-toc-id", `h${h}`);
    heading.insert(0, [new Y.XmlText(`Section ${h}`)]);
    const paragraph = new Y.XmlElement("paragraph");
    const text = new Y.XmlText();
    text.insert(0, `Paragraph ${h} `.padEnd(paragraphBytes, "lorem ipsum "));
    paragraph.insert(0, [text]);
    blocks.push(heading, paragraph);
  }
  fragment.insert(0, blocks);
  return doc;
}

async function caseT23(): Promise<CaseResult> {
  const days = Number(args["t23-days"] ?? 365);
  const dir = mkdtempSync(join(tmpdir(), "soak-t23-"));
  const failures: string[] = [];
  const clock = { now: Date.UTC(2026, 0, 1) };
  const library = Library.open({
    dir,
    host: createNodeHost({ now: () => clock.now }),
    openSqlite: openBunSqlite,
    fullfsync: false,
  });
  const { id } = library.createDoc({ title: "long" });
  library.load(id, "w");
  const doc = buildLongDoc(5000, 1500);
  let acked = library.append(id, "w", {
    origin: "local",
    update: Y.encodeStateAsUpdate(doc),
  });
  library.compact(id, "w", Y.encodeStateAsUpdate(doc), acked);
  const random = seededRandom(23);
  const fragment = doc.getXmlFragment("default");
  let rows = 0;
  let rowBytes = 0;
  let compactions = 0;
  let maxSeen = 0;
  for (let day = 0; day < days; day += 1) {
    for (let batch = 0; batch < 20; batch += 1) {
      let update: Uint8Array = new Uint8Array();
      doc.once("update", (u: Uint8Array) => {
        update = u;
      });
      doc.transact(() => {
        for (let edit = 0; edit < 10; edit += 1) {
          const block = fragment.get(
            1 + 2 * Math.floor(random() * 5000),
          ) as Y.XmlElement;
          const text = block.get(0) as Y.XmlText;
          if (random() < 0.5 && text.length > 50)
            text.delete(Math.floor(random() * (text.length - 40)), 30);
          else
            text.insert(Math.floor(random() * text.length), "edit ".repeat(6));
        }
      });
      acked = library.append(id, "w", { origin: "local", update });
      rows += 1;
      rowBytes += update.byteLength;
      clock.now += 60_000;
      // The batcher's trigger (§5.1): 500 rows, or max(1 MiB, 25% of the snapshot).
      const snapshotBytes = library.stats().bytes;
      if (rows > 500 || rowBytes > Math.max(1048576, 0.25 * snapshotBytes)) {
        library.compact(id, "w", Y.encodeStateAsUpdate(doc), acked);
        compactions += 1;
        rows = 0;
        rowBytes = 0;
      }
      maxSeen = Math.max(maxSeen, statSync(join(dir, LIBRARY_FILE)).size);
    }
    clock.now = Date.UTC(2026, 0, 2 + day);
  }
  library.compact(id, "w", Y.encodeStateAsUpdate(doc), acked);
  const live = (() => {
    const fresh = new Y.Doc();
    Y.applyUpdate(fresh, Y.encodeStateAsUpdate(doc));
    return Y.encodeStateAsUpdate(fresh).byteLength;
  })();
  const raw = new Database(join(dir, LIBRARY_FILE), { readonly: true });
  const pageSize = (
    raw.query("PRAGMA page_size").get() as { page_size: number }
  ).page_size;
  const pages = (raw.query("PRAGMA page_count").get() as { page_count: number })
    .page_count;
  const free = (
    raw.query("PRAGMA freelist_count").get() as { freelist_count: number }
  ).freelist_count;
  raw.close();
  const file = pages * pageSize;
  const wal = join(dir, `${LIBRARY_FILE}-wal`);
  const walBytes = existsSync(wal) ? statSync(wal).size : 0;
  library.shutdown();
  const used = file - free * pageSize;
  if (used > 3 * live)
    failures.push(`file minus free pages ${used} B > 3× live state ${live} B`);
  removeDir(dir);
  return {
    name: "T23",
    pass: failures.length === 0,
    summary: `${days} days × 200 edits on a ${(live / 1048576).toFixed(1)} MB document (5,000 headings): ${compactions} compactions; file ${(file / 1048576).toFixed(1)} MB, free ${((free * pageSize) / 1048576).toFixed(1)} MB, WAL ${(walBytes / 1048576).toFixed(1)} MB, live state ${(live / 1048576).toFixed(1)} MB; file minus free pages = ${(used / live).toFixed(2)}× live (mark ≤ 3×)`,
    details: {
      days,
      live,
      file,
      free: free * pageSize,
      walBytes,
      compactions,
      maxSeen,
    },
    failures,
  };
}

// ── T20 / T20b, storage half: an 8 MiB document, then the 32 MiB cap ──

async function caseT20(): Promise<CaseResult> {
  const dir = mkdtempSync(join(tmpdir(), "soak-t20-"));
  const failures: string[] = [];
  const library = openEngine(dir);
  const { id } = library.createDoc({ title: "long-8m" });
  library.load(id, "seed");
  const doc = buildLongDoc(5000, 1600);
  const state = Y.encodeStateAsUpdate(doc);
  const seq = library.append(id, "seed", { origin: "local", update: state });
  library.close(id, "seed");
  library.shutdown();
  void seq;
  const run = await runHarness(
    ["--mode=long-doc", `--dir=${dir}`, `--doc=${id}`, "--grow"],
    () => {},
    300_000,
  );
  const line = run.lines.find((l) => l.startsWith("LONGDOC "));
  const result = line ? JSON.parse(line.slice(8)) : null;
  if (!result) failures.push(`no result: ${run.stderr.slice(0, 500)}`);
  else {
    if (!result.refused)
      failures.push("the 32 MiB cap never refused an append");
    if (!result.deleteOk) failures.push("a deletion at the cap was refused");
    const openBudget = process.platform === "darwin" ? 2000 : 3000;
    if (result.loadMs + result.applyMs > openBudget * 1.5)
      failures.push(
        `open ${Math.round(result.loadMs + result.applyMs)} ms, provisional mark ${openBudget} ms (× 1.5)`,
      );
  }
  removeDir(dir);
  return {
    name: "T20",
    pass: failures.length === 0,
    summary: result
      ? `long-8m (${(result.bytes / 1048576).toFixed(1)} MB, 5,000 headings): worker load ${Math.round(result.loadMs)} ms + apply ${Math.round(result.applyMs)} ms; compaction with the I10 check ${Math.round(result.compactMs)} ms (provisional mark 320 ms, reported); T20b: grew to the cap (${(result.appended / 1048576).toFixed(0)} MB appended), then refused, a deletion still passed; main RSS ${(result.rss / 1048576).toFixed(0)} MB. Typing marks wait for B0.`
      : "no result",
    details: result ?? {},
    failures,
  };
}

// ── Main ────────────────────────────────────────────────────────────────

const CASES: Record<string, () => Promise<CaseResult>> = {
  contract: caseContract,
  T1: () => killLoop("T1", "append", KILLS),
  "T1-dense": () =>
    killLoop("T1-dense", "append", Math.ceil(KILLS / 2), { dense: true }),
  T2: () => killLoop("T2", "compaction", KILLS),
  T3: caseT3,
  T4: () => caseT4(Number(args.quits ?? 20)),
  "T4-copy": () => caseQuitDuringCopy(Number(args["copy-quits"] ?? 10)),
  T5: () => caseT5(Number(args["migration-kills"] ?? 40)),
  T6: caseT6,
  T8: caseT8,
  T20: caseT20,
  T23: caseT23,
  T24: caseT24,
  T24b: caseT24b,
  T21: () => caseT21({ runHarness, removeDir, args }),
};

const selected =
  !args.case || args.case === "all"
    ? Object.keys(CASES)
    : args.case.split(",").map((name) => name.trim());

const results: CaseResult[] = [];
for (const name of selected) {
  const run = CASES[name];
  if (!run) throw new Error(`unknown case ${name}`);
  const t0 = performance.now();
  let result: CaseResult;
  try {
    result = await run();
  } catch (error) {
    result = {
      name,
      pass: false,
      summary: "crashed",
      details: {},
      failures: [String(error instanceof Error ? error.stack : error)],
    };
  }
  result.details.seconds = Math.round((performance.now() - t0) / 1000);
  results.push(result);
  writeFileSync(join(OUT, `${name}.json`), JSON.stringify(result, null, 2));
  console.log(`${result.pass ? "PASS" : "FAIL"} ${name}: ${result.summary}`);
  for (const failure of result.failures.slice(0, 10))
    console.log(`  - ${failure}`);
}

const table = [
  `### Desktop storage soak (${process.platform}-${process.arch})`,
  "",
  "| Case | Result | Summary |",
  "|---|---|---|",
  ...results.map(
    (r) =>
      `| ${r.name} | ${r.pass ? "pass" : "**fail**"} | ${r.summary.replace(/\|/g, "\\|")} |`,
  ),
  "",
].join("\n");
if (process.env.GITHUB_STEP_SUMMARY)
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, table);
process.exit(results.every((r) => r.pass) ? 0 : 1);
