import { describe, expect, it } from "bun:test";

import {
  packShards,
  parseTimings,
  smoothTimings,
  type Timings,
  timingsFromReport,
} from "../../../scripts/e2e-shards";

describe("packShards", () => {
  const cases: {
    name: string;
    files: string[];
    timings: Record<string, number>;
    total: number;
    expected: string[][] | null;
  }[] = [
    {
      name: "puts the longest files apart",
      files: ["a", "b", "c", "d", "e", "f"],
      timings: { a: 100, b: 90, c: 80, d: 30, e: 20, f: 10 },
      total: 3,
      // a | b | c, then d, e and f, each into the lightest shard.
      expected: [
        ["a", "f"],
        ["b", "e"],
        ["c", "d"],
      ],
    },
    {
      name: "spreads many short files evenly",
      files: ["a", "b", "c", "d"],
      timings: { a: 10, b: 10, c: 10, d: 10 },
      total: 2,
      expected: [
        ["a", "c"],
        ["b", "d"],
      ],
    },
    {
      name: "weighs a new file as the median of the known ones",
      files: ["a", "b", "c", "new"],
      timings: { a: 50, b: 10, c: 30 },
      total: 2,
      // a 50 | c 30 + new 30 (median) | then b 10 goes to a's shard.
      expected: [
        ["a", "b"],
        ["c", "new"],
      ],
    },
    {
      name: "ignores timings of files that no longer exist",
      files: ["a", "b"],
      timings: { a: 5, b: 5, gone: 1000 },
      total: 2,
      expected: [["a"], ["b"]],
    },
    {
      name: "counts every file once",
      files: ["a", "a", "b"],
      timings: { a: 5, b: 5 },
      total: 2,
      expected: [["a"], ["b"]],
    },
    {
      name: "refuses a plan with an empty shard",
      files: ["a", "b"],
      timings: { a: 5, b: 5 },
      total: 3,
      expected: null,
    },
    {
      name: "breaks ties by name, so every shard computes the same plan",
      files: ["d", "c", "b", "a"],
      timings: {},
      total: 2,
      expected: [
        ["a", "c"],
        ["b", "d"],
      ],
    },
  ];

  it.each(cases)("$name", ({ files, timings, total, expected }) => {
    expect(packShards(files, timings, total)).toEqual(expected);
  });

  it("returns every file exactly once", () => {
    const files = Array.from({ length: 49 }, (_, i) => `spec-${i}.spec.ts`);
    const timings = Object.fromEntries(
      files.map((file, i) => [file, (i * 37) % 200]),
    );
    const shards = packShards(files, timings, 3) ?? [];
    expect(shards.flat().sort()).toEqual([...files].sort());
  });
});

describe("parseTimings", () => {
  it("accepts an object of file to seconds", () => {
    expect(parseTimings('{"a.spec.ts": 12.5, "b.spec.ts": 0}')).toEqual({
      "a.spec.ts": 12.5,
      "b.spec.ts": 0,
    });
  });

  it.each([
    ["not JSON", "{"],
    ["an array", "[1]"],
    ["null", "null"],
    ["empty", "{}"],
    ["a string time", '{"a": "12"}'],
    ["a negative time", '{"a": -1}'],
  ])("rejects %s", (_label, text) => {
    expect(() => parseTimings(text)).toThrow();
  });
});

describe("timingsFromReport", () => {
  it("sums every attempt of every test per file", () => {
    const report = {
      suites: [
        {
          file: "a.spec.ts",
          specs: [
            { tests: [{ results: [{ duration: 1500 }, { duration: 500 }] }] },
          ],
          suites: [{ specs: [{ tests: [{ results: [{ duration: 1000 }] }] }] }],
        },
        { file: "b.spec.ts", specs: [{ tests: [{ results: [] }] }] },
        {
          file: "c.spec.ts",
          specs: [{ tests: [{ results: [{ duration: 250 }] }] }],
        },
      ],
    };
    expect(timingsFromReport(report)).toEqual({
      "a.spec.ts": 3,
      "c.spec.ts": 0.3,
    });
  });
});

describe("smoothTimings", () => {
  const cases: {
    name: string;
    current: Timings;
    previous: Timings;
    expected: Timings;
  }[] = [
    {
      name: "averages a file timed in both runs",
      current: { a: 263 },
      previous: { a: 116 },
      expected: { a: 189.5 },
    },
    {
      name: "keeps a new file's own time",
      current: { a: 10, fresh: 42 },
      previous: { a: 20 },
      expected: { a: 15, fresh: 42 },
    },
    {
      name: "drops a file the new run did not time",
      current: { a: 10 },
      previous: { a: 10, deleted: 300 },
      expected: { a: 10 },
    },
    {
      name: "converges on a steady time",
      current: { a: 100 },
      previous: { a: 100 },
      expected: { a: 100 },
    },
  ];

  it.each(cases)("$name", ({ current, previous, expected }) => {
    expect(smoothTimings(current, previous)).toEqual(expected);
  });

  it("weights the newest run as asked", () => {
    expect(smoothTimings({ a: 100 }, { a: 0 }, 0.25)).toEqual({ a: 25 });
  });
});
