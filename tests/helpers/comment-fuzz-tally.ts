import {
  type FuzzCaseOptions,
  type FuzzFailure,
  runFuzzCase,
} from "./comment-anchor-fuzz";

export interface FuzzTally {
  cases: number;
  threads: number;
  trimmed: number;
  byInvariant: Record<string, number>;
  samples: FuzzFailure[];
}

/** Runs seeds `first`…`first + cases − 1` and counts failed invariants. */
export function tallyFuzz(
  first: number,
  cases: number,
  options: FuzzCaseOptions = {},
): FuzzTally {
  const tally: FuzzTally = {
    cases,
    threads: 0,
    trimmed: 0,
    byInvariant: { 1: 0, 2: 0, 3: 0, "3-trimmed": 0 },
    samples: [],
  };
  for (let seed = first; seed < first + cases; seed++) {
    const result = runFuzzCase(seed, options);
    tally.threads += result.threads;
    tally.trimmed += result.trimmed;
    for (const failure of result.failures) {
      tally.byInvariant[failure.invariant]++;
      if (tally.samples.length < 5) tally.samples.push(failure);
    }
  }
  return tally;
}

/**
 * The bounds the suite holds. Measured on the 2,000 seeded cases (31,584
 * threads, 2,978 of them trimmed): invariant 1 never fails; 2 fails for 7
 * threads (0.02%), 3 for 5 untrimmed threads (0.02%), and 3 for 257
 * trimmed ones (8.6%; 15.7% when a join comes first). At 50,000 cases
 * (769,424 threads): 1 fails 20 (0.003%), 2 fails 213 (0.03%), 3 fails 214
 * untrimmed (0.03%) and 6,728 trimmed (8.7%). Each residual is a
 * case where the sync plugin's string diff deletes other, equal
 * characters than ProseMirror did, or where text a re-anchor had to leave
 * out comes back with undo (comments design §13).
 */
export function expectWithinBounds(
  tally: FuzzTally,
  expect: (value: unknown) => {
    toBe(v: unknown): void;
    toBeLessThanOrEqual(v: number): void;
  },
): void {
  const untrimmed = tally.threads - tally.trimmed;
  // 0 on the unit suite's seeds; the 50,000-case probe found 20 of
  // 769,424 threads (0.003%), every one after a string-diff mismatch.
  expect(tally.byInvariant[1]).toBeLessThanOrEqual(
    Math.floor(tally.threads * 0.00005),
  );
  expect(tally.byInvariant[2]).toBeLessThanOrEqual(
    Math.ceil(tally.threads * 0.001),
  );
  expect(tally.byInvariant[3]).toBeLessThanOrEqual(
    Math.ceil(untrimmed * 0.001),
  );
  expect(tally.byInvariant["3-trimmed"]).toBeLessThanOrEqual(
    Math.ceil(tally.trimmed * 0.2),
  );
}
