/**
 * Format steps for soak T5 (migration interrupted). Each step builds a
 * table of {@link STEP_ROWS} rows, slow enough that a kill lands inside one.
 * The Electron run and the Bun verifier use the same list.
 */
import type { FormatStep } from "../storage/engine/migrations";

export const STEP_ROWS = 150_000;
export const T5_TARGET = 4;

export const T5_STEPS: FormatStep[] = [2, 3, 4].map((to) => ({
  to,
  up(db) {
    db.exec(`CREATE TABLE soak_step_${to} (n INTEGER NOT NULL) STRICT`);
    const insert = db.prepare(`INSERT INTO soak_step_${to} (n) VALUES (?)`);
    for (let n = 0; n < STEP_ROWS; n += 1) insert.run(n);
  },
}));
