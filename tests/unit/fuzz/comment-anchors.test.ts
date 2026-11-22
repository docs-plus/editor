/**
 * Comment anchor fuzz (comments design §10, PR P4.9): 2,000 seeded random
 * documents with 1–30 threads and 1–12 random edits each, every edit
 * written through `updateYFragment` and the real re-anchor logic. The
 * stress probe runs 50,000 (`tests/unit/stress/comment-anchors.test.ts`).
 * Invariants and their bounds: `tests/helpers/comment-anchor-fuzz.ts`.
 */
import { describe, expect, it } from "bun:test";

import {
  joinBeforeThread,
  splitBeforeThread,
} from "../../helpers/comment-anchor-fuzz";
import {
  expectWithinBounds,
  tallyFuzz,
} from "../../helpers/comment-fuzz-tally";

const CASES = 2_000;
const FIXED = 300;

describe("comment anchor fuzz", () => {
  it(
    `${CASES} random histories keep every invariant within its bound`,
    () => {
      const tally = tallyFuzz(1, CASES);
      console.log("comment anchor fuzz", {
        ...tally,
        samples: tally.samples.length,
      });
      expect(tally.threads).toBeGreaterThan(CASES * 10);
      expect(tally.byInvariant[1]).toBe(0);
      expectWithinBounds(tally, expect);
    },
    { timeout: 300_000 },
  );

  it(
    "a split before a thread's range, in its block: exact, and undo restores it",
    () => {
      const alone = tallyFuzz(100_001, FIXED, {
        first: splitBeforeThread,
        maxOps: 0,
      });
      expect(alone.byInvariant).toEqual({ 1: 0, 2: 0, 3: 0, "3-trimmed": 0 });
      expect(alone.threads).toBeGreaterThan(FIXED * 10);
      expectWithinBounds(
        tallyFuzz(110_001, FIXED, { first: splitBeforeThread, maxOps: 4 }),
        expect,
      );
    },
    { timeout: 120_000 },
  );

  it(
    "a join of a thread's block with the one before: exact, and undo restores it",
    () => {
      const alone = tallyFuzz(200_001, FIXED, {
        first: joinBeforeThread,
        maxOps: 0,
      });
      expect(alone.byInvariant).toEqual({ 1: 0, 2: 0, 3: 0, "3-trimmed": 0 });
      expect(alone.threads).toBeGreaterThan(FIXED * 10);
      expectWithinBounds(
        tallyFuzz(210_001, FIXED, { first: joinBeforeThread, maxOps: 4 }),
        expect,
      );
    },
    { timeout: 120_000 },
  );
});
