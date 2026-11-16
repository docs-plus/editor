// S2 kill harness (Bun). Launches the real Electron binary (never the
// `electron` bin wrapper, which doesn't forward SIGKILL), SIGKILLs it
// mid-churn, waits for the pid to be gone, then reopens the database in a
// `--mode=verify` Electron and checks: quick_check ok, every acked seq
// present, rows contiguous after the snapshot (fully before or fully after a
// compaction), and the rebuilt text and state vector equal the reference.
//
//   bun kill-harness.ts --kills 200 --target append|compaction [--synchronous=OFF]
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import * as Y from "yjs";

import { applyEdit, newGeneratorDoc, textHash } from "./gen";

const args = Object.fromEntries(
  process.argv.slice(2).flatMap((arg, i, all) => {
    const eq = arg.match(/^--([\w-]+)=(.*)$/);
    if (eq) return [[eq[1], eq[2]]];
    const flag = arg.match(/^--([\w-]+)$/);
    if (flag) return [[flag[1], all[i + 1] ?? "1"]];
    return [];
  }),
) as Record<string, string>;

const kills = Number(args.kills ?? 200);
const target = args.target ?? "append";
const synchronous = args.synchronous ?? "FULL";
const seed = Number(args.seed ?? 42);
// The compaction target works on a 5 MB document, as the plan asks.
const seedBytes =
  target === "compaction"
    ? 5 * 1024 * 1024
    : Number(args["seed-bytes"] ?? 64 * 1024);
const outDir = args.out ?? "harness-out";
// --dense: 5 ms debounce / 20 ms cap instead of 250 ms / 1 s, so batches
// commit back to back and more kills land inside a transaction (extra
// evidence beside the plan's rows, not a replacement).
const dense = Boolean(args.dense);
const label = `${target}-${synchronous}${dense ? "-dense" : ""}`;

mkdirSync(outDir, { recursive: true });
const workDir = mkdtempSync(path.join(tmpdir(), `s2-${label}-`));
const dbPath = path.join(workDir, "s2.sqlite");
const electron = require("electron") as string;
const mainPath = path.join(import.meta.dir, "dist", "main.cjs");
const isWindows = process.platform === "win32";

const log: string[] = [];
const note = (text: string) => {
  log.push(text);
  if (args.verbose) console.log(text);
};

const pidGone = (pid: number) => {
  if (isWindows) {
    const out = Bun.spawnSync(["tasklist", "/FI", `PID eq ${pid}`, "/NH"]);
    return !out.stdout.toString().includes(` ${pid} `);
  }
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ESRCH";
  }
};

const commonArgs = [
  `--db=${dbPath}`,
  `--synchronous=${synchronous}`,
  `--seed=${seed}`,
  `--seed-bytes=${seedBytes}`,
  ...(dense ? ["--debounce-ms=5", "--max-wait-ms=20"] : []),
];

/** Reads stdout line by line, calling `onLine` for each. */
const pump = async (
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
) => {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl = buffer.indexOf("\n");
    while (nl >= 0) {
      onLine(buffer.slice(0, nl).trimEnd());
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf("\n");
    }
  }
  if (buffer) onLine(buffer.trimEnd());
};

const verifyOnce = async () => {
  const proc = Bun.spawn([electron, mainPath, "--mode=verify", ...commonArgs], {
    stdout: "pipe",
    stderr: "pipe",
  });
  let resultLine = "";
  await pump(proc.stdout, (line) => {
    if (line.startsWith("RESULT ") || line.startsWith("FAIL "))
      resultLine = line;
  });
  await proc.exited;
  if (!resultLine.startsWith("RESULT ")) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`verify failed: ${resultLine} ${stderr.slice(-2000)}`);
  }
  return JSON.parse(resultLine.slice("RESULT ".length)) as {
    inspected: {
      quickCheck: string[];
      snapshotSeq: number;
      rowCount: number;
      maxSeq: number;
      contiguous: boolean;
    };
    maxSeq: number;
    textHash: string;
    stateVector: string;
  };
};

// The reference only ever moves forward: committed seqs never disappear.
const reference = newGeneratorDoc();
let referenceSeq = 0;
const referenceAt = (seq: number) => {
  if (seq < referenceSeq)
    throw new Error(`seq went back: ${seq} < ${referenceSeq}`);
  while (referenceSeq < seq) {
    referenceSeq += 1;
    applyEdit(reference, seed, referenceSeq, seedBytes);
  }
  return {
    textHash: textHash(reference),
    stateVector: Buffer.from(Y.encodeStateVector(reference)).toString("base64"),
  };
};

const summary = {
  target,
  dense,
  synchronous,
  platform: process.platform,
  arch: process.arch,
  kills: 0,
  killsAfterFirstAck: 0,
  killsInsideBatch: 0,
  killsInsideCompaction: 0,
  // Of the kills inside a compaction: the reopened state is the old snapshot
  // (before) or the new one (after); anything else fails `contiguous`.
  compactionKillsBefore: 0,
  compactionKillsAfter: 0,
  compactionsAcked: 0,
  lostAckedRows: 0,
  quickCheckFailures: 0,
  notContiguous: 0,
  referenceMismatches: 0,
  pidStillAlive: 0,
  maxSeq: 0,
  maxAcked: 0,
  failures: [] as string[],
  wallSeconds: 0,
};

const started = performance.now();
let maxAcked = 0;

for (let run = 1; run <= kills; run += 1) {
  const proc = Bun.spawn(
    [electron, mainPath, "--mode=churn", `--target=${target}`, ...commonArgs],
    { stdout: "pipe", stderr: "pipe" },
  );
  let lastProtocol = "";
  let compactSeq = -1;
  let ackedThisRun = 0;
  let killed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const kill = () => {
    if (killed) return;
    killed = true;
    proc.kill("SIGKILL");
  };

  if (target === "compaction") {
    // Safety net: kill anyway if no compaction starts within 15 s.
    timer = setTimeout(kill, 15_000);
  } else {
    timer = setTimeout(kill, 50 + Math.random() * 1950);
  }

  const pumped = pump(proc.stdout, (line) => {
    if (line.startsWith("FAIL ")) note(`run ${run}: ${line}`);
    const [kind, value] = line.split(" ");
    if (kind === "ACK") {
      ackedThisRun += 1;
      maxAcked = Math.max(maxAcked, Number(value));
    }
    if (kind === "COMPACT_ACK") summary.compactionsAcked += 1;
    if (kind && /^(BATCH_BEGIN|ACK|COMPACT_BEGIN|COMPACT_ACK)$/.test(kind)) {
      lastProtocol = kind;
    }
    if (kind === "COMPACT_BEGIN") compactSeq = Number(value);
    if (kind === "COMPACT_BEGIN" && target === "compaction" && !killed) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(kill, Math.random() * 20);
    }
  });

  await proc.exited;
  if (timer) clearTimeout(timer);
  await pumped;
  if (!killed) {
    const stderr = await new Response(proc.stderr).text();
    summary.failures.push(
      `run ${run}: exited by itself (${proc.exitCode}) ${stderr.slice(-500)}`,
    );
    continue;
  }
  if (!pidGone(proc.pid)) {
    summary.pidStillAlive += 1;
    summary.failures.push(`run ${run}: pid ${proc.pid} still alive`);
    break;
  }

  summary.kills += 1;
  if (ackedThisRun > 0) summary.killsAfterFirstAck += 1;
  if (lastProtocol === "BATCH_BEGIN") summary.killsInsideBatch += 1;
  if (lastProtocol === "COMPACT_BEGIN") summary.killsInsideCompaction += 1;

  const v = await verifyOnce();
  const ref = referenceAt(v.maxSeq);
  const problems: string[] = [];
  if (v.inspected.quickCheck.join() !== "ok") {
    summary.quickCheckFailures += 1;
    problems.push(`quick_check ${v.inspected.quickCheck.join()}`);
  }
  if (v.maxSeq < maxAcked) {
    summary.lostAckedRows += maxAcked - v.maxSeq;
    problems.push(`lost acked rows: max ${v.maxSeq} < acked ${maxAcked}`);
  }
  if (!v.inspected.contiguous) {
    summary.notContiguous += 1;
    problems.push(
      `rows not contiguous after snapshot ${v.inspected.snapshotSeq}`,
    );
  }
  if (ref.textHash !== v.textHash || ref.stateVector !== v.stateVector) {
    summary.referenceMismatches += 1;
    problems.push(`state != reference at ${v.maxSeq}`);
  }
  if (lastProtocol === "COMPACT_BEGIN") {
    if (v.inspected.snapshotSeq === compactSeq)
      summary.compactionKillsAfter += 1;
    else summary.compactionKillsBefore += 1;
  }
  summary.maxSeq = v.maxSeq;
  summary.maxAcked = maxAcked;
  note(
    `run ${run}: last=${lastProtocol || "-"} acked=${maxAcked} max=${v.maxSeq} snapshot=${v.inspected.snapshotSeq} rows=${v.inspected.rowCount} ${problems.join("; ") || "ok"}`,
  );
  if (problems.length)
    summary.failures.push(`run ${run}: ${problems.join("; ")}`);
  if (run % 20 === 0) console.log(`${label}: ${run}/${kills} kills`);
}

summary.wallSeconds = Math.round((performance.now() - started) / 1000);
const pass =
  summary.kills === kills &&
  summary.failures.length === 0 &&
  (target !== "compaction" || summary.killsInsideCompaction >= kills / 2);
writeFileSync(path.join(outDir, `${label}.log`), `${log.join("\n")}\n`);
writeFileSync(
  path.join(outDir, `${label}.json`),
  `${JSON.stringify({ pass, ...summary }, null, 2)}\n`,
);
console.log(`SUMMARY ${JSON.stringify({ pass, ...summary })}`);
process.exit(pass ? 0 : 1);
