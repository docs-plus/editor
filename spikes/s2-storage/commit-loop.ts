// Back-to-back 4 KB commits: the durability evidence (F_FULLFSYNC shows up as
// commit time) and the load for S5's commit arms.
import type { DatabaseSync } from "node:sqlite";

import { timedCommit } from "./engine";

export interface CommitStats {
  commits: number;
  size: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
  mean: number;
  commitsPerSecond: number;
}

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ??
  0;

const round = (n: number) => Math.round(n * 1000) / 1000;

export const summarize = (
  times: number[],
  size: number,
  wallMs: number,
): CommitStats => {
  const sorted = [...times].sort((a, b) => a - b);
  return {
    commits: times.length,
    size,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    p99: round(percentile(sorted, 99)),
    max: round(sorted[sorted.length - 1] ?? 0),
    mean: round(times.reduce((a, b) => a + b, 0) / (times.length || 1)),
    commitsPerSecond: round((times.length / wallMs) * 1000),
  };
};

const prepare = (db: DatabaseSync, size: number) => {
  db.exec("DELETE FROM updates WHERE doc_id = 'commit-loop'");
  db.prepare(
    "INSERT OR IGNORE INTO docs (id, created_at) VALUES ('commit-loop', 0)",
  ).run();
  const insert = db.prepare(
    "INSERT INTO updates (doc_id, seq, origin, data) VALUES (?, ?, 'loop', ?)",
  );
  const payload = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) payload[i] = (i * 31) & 0xff;
  return { insert, payload };
};

/** `count` commits in a row, synchronously (worker thread). */
export const runCommitLoop = (
  db: DatabaseSync,
  count: number,
  size: number,
): CommitStats => {
  const { insert, payload } = prepare(db, size);
  const times: number[] = [];
  const start = performance.now();
  for (let seq = 1; seq <= count; seq += 1) {
    times.push(timedCommit(db, insert, seq, payload));
  }
  return summarize(times, size, performance.now() - start);
};

/**
 * Back-to-back commits on the calling thread until `stop()`, yielding to the
 * event loop between commits so input (main) or a stop request (worker) is
 * still handled. S5's `electron-main-commits` runs it on main's own thread,
 * `electron-worker-commits` in the worker.
 */
export const startCommitLoop = (db: DatabaseSync, size: number) => {
  const { insert, payload } = prepare(db, size);
  const times: number[] = [];
  const start = performance.now();
  let seq = 0;
  let running = true;
  const tick = () => {
    if (!running) return;
    seq += 1;
    times.push(timedCommit(db, insert, seq, payload));
    setImmediate(tick);
  };
  setImmediate(tick);
  return {
    stop: (): CommitStats => {
      running = false;
      return summarize(times, size, performance.now() - start);
    },
  };
};
