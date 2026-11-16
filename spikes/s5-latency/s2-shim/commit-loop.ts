// TEMPORARY stand-in for spikes/s2-storage/commit-loop.ts (startCommitLoop).
import type { DatabaseSync } from "node:sqlite";

import { timedCommit } from "./engine";

const pct = (s: number[], p: number) =>
  s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;

export const startCommitLoop = (db: DatabaseSync, size: number) => {
  db.exec("DELETE FROM updates WHERE doc_id = 'commit-loop'");
  db.prepare(
    "INSERT OR IGNORE INTO docs (id, created_at) VALUES ('commit-loop', 0)",
  ).run();
  const insert = db.prepare(
    "INSERT INTO updates (doc_id, seq, origin, data) VALUES (?, ?, 'loop', ?)",
  );
  const payload = new Uint8Array(size).map((_, i) => (i * 31) & 0xff);
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
    stop: () => {
      running = false;
      const wall = performance.now() - start;
      const sorted = [...times].sort((a, b) => a - b);
      return {
        commits: times.length,
        size,
        p50: pct(sorted, 50),
        p95: pct(sorted, 95),
        p99: pct(sorted, 99),
        max: sorted.at(-1) ?? 0,
        commitsPerSecond: (times.length / wall) * 1000,
      };
    },
  };
};
