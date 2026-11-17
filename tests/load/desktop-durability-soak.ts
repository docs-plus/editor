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
 *   bun tests/load/desktop-durability-soak.ts --case=all|contract|T1|T2|T3|T4|T5|T6|T8
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
  const dir = mkdtempSync(join(tmpdir(), "soak-contract-"));
  const run = await runHarness([`--mode=contract`, `--dir=${dir}`]);
  removeDir(dir);
  const ok = run.lines.filter((l) => l.startsWith("CASE_OK")).length;
  const failed = run.lines.filter((l) => l.startsWith("CASE_FAIL"));
  const stats = run.lines.find((l) => l.startsWith("STATS "));
  return {
    name: "contract",
    pass: run.exitCode === 0 && failed.length === 0 && ok > 0,
    summary: `${ok} DocStore cases passed on node:sqlite in the Electron worker`,
    details: {
      ok,
      stats: stats ? JSON.parse(stats.slice(6)) : null,
      exitCode: run.exitCode,
    },
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
    summary: `${kills} kills during a 3-step migration (${Math.round(fullMs)} ms); stopped at v1–v4: ${JSON.stringify(reached)}; each step all-or-nothing, every resume reached v${T5_TARGET}`,
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
    (_, i) => library.createFolder({ name: `Folder ${i}` }).id,
  );
  const tags = Array.from(
    { length: 20 },
    (_, i) => library.createTag(`tag-${i}`).id,
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
    const idle = library.runIdleJobs();
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
  removeDir(dir);
  return {
    name: "T8",
    pass: failures.length === 0,
    summary: `${days} days, ${appends} appends, ${compactions} compactions, ${trashed} trashed; ${(seededBytes / 1048576).toFixed(0)} → ${(stats.bytes / 1048576).toFixed(0)} MB; ${dailies.length} daily copies (VACUUM INTO median ${copyMedian.toFixed(0)} ms, max ${copyMax.toFixed(0)} ms); ${liveDocs} documents: worker ready ${toWorkerReady.toFixed(0)} ms and sidebar rows ${toSidebar.toFixed(0)} ms after process start (median of 5; §10 ${budget.workerReadyMs} / ${budget.sidebarMs} ms; excludes renderer IPC and paint); unclean-exit open with quick_check ${unclean ? unclean.openMs.toFixed(0) : "n/a"} ms`,
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
      simMs,
    },
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
  T5: () => caseT5(Number(args["migration-kills"] ?? 40)),
  T6: caseT6,
  T8: caseT8,
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
