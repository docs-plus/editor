// Duration-balanced Playwright shards for CI (tests/TESTING.md, "Shard
// balance"). Playwright's own --shard splits by test count, so the specs
// with slow tests pile up in one shard; this packs spec files by the time
// they took on the latest green run on main instead.
//
//   bun scripts/e2e-shards.ts plan <current>/<total> <timings.json> <list.txt>
//     Prints the Playwright arguments for this shard: `--test-list=<list.txt>`
//     after writing the shard's files there, or `--shard=<current>/<total>`
//     (Playwright's own split) when the timings are missing or invalid.
//   bun scripts/e2e-shards.ts timings <report.json> <timings.json>
//     Writes per-file seconds from a merged Playwright JSON report.
//
// Every shard computes the same plan from the same inputs, so together
// they run each spec file exactly once.

import { readFileSync, writeFileSync } from "node:fs";

export type Timings = Record<string, number>;

/** Parses a timings file: an object of spec file → seconds (finite, ≥ 0). */
export const parseTimings = (text: string): Timings => {
  const value: unknown = JSON.parse(text);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("timings must be an object");
  }
  const timings: Timings = {};
  for (const [file, seconds] of Object.entries(value)) {
    if (
      typeof seconds !== "number" ||
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      throw new Error(`bad timing for ${file}`);
    }
    timings[file] = seconds;
  }
  if (Object.keys(timings).length === 0) throw new Error("no timings");
  return timings;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
};

/**
 * Greedy packing (longest first, into the least-loaded shard). A file with
 * no timing (a new spec) counts as the median of the known ones. Returns
 * each shard's files sorted by name, or null when a shard would be empty
 * (a plan Playwright must not be given: an empty list runs nothing).
 */
export const packShards = (
  files: string[],
  timings: Timings,
  total: number,
): string[][] | null => {
  const known = files.flatMap((file) =>
    timings[file] === undefined ? [] : [timings[file]],
  );
  const fallback = known.length > 0 ? median(known) : 1;
  const weighted = [...new Set(files)]
    .map((file) => ({ file, seconds: timings[file] ?? fallback }))
    .sort((a, b) => b.seconds - a.seconds || a.file.localeCompare(b.file));
  const shards = Array.from({ length: total }, () => ({
    seconds: 0,
    files: [] as string[],
  }));
  for (const { file, seconds } of weighted) {
    const lightest = shards.reduce((best, shard) =>
      shard.seconds < best.seconds ? shard : best,
    );
    lightest.files.push(file);
    lightest.seconds += seconds;
  }
  if (shards.some((shard) => shard.files.length === 0)) return null;
  return shards.map((shard) => shard.files.sort());
};

interface ReportSuite {
  file?: string;
  specs?: { tests: { results?: { duration?: number }[] }[] }[];
  suites?: ReportSuite[];
}

/** Per-file seconds (every attempt counts) from a Playwright JSON report. */
export const timingsFromReport = (report: { suites?: ReportSuite[] }) => {
  const timings: Timings = {};
  const add = (file: string, suite: ReportSuite) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests) {
        for (const result of test.results ?? []) {
          timings[file] = (timings[file] ?? 0) + (result.duration ?? 0) / 1000;
        }
      }
    }
    for (const child of suite.suites ?? []) add(file, child);
  };
  for (const suite of report.suites ?? []) {
    if (suite.file) add(suite.file, suite);
  }
  for (const file of Object.keys(timings)) {
    timings[file] = Math.round(timings[file] * 10) / 10;
  }
  return timings;
};

/** Spec files Playwright would run, relative to its rootDir. */
const listSpecFiles = (projects: string[]) => {
  const result = Bun.spawnSync(
    [
      "bun",
      "playwright",
      "test",
      "--list",
      "--reporter=json",
      ...projects.map((project) => `--project=${project}`),
    ],
    { env: { ...process.env, CI: "" }, stderr: "inherit" },
  );
  if (result.exitCode !== 0) throw new Error("playwright --list failed");
  const report = JSON.parse(result.stdout.toString()) as {
    suites: ReportSuite[];
  };
  return report.suites.flatMap((suite) => (suite.file ? [suite.file] : []));
};

export const PROJECTS = ["chromium", "library"];

const plan = (shardArg: string, timingsPath: string, listPath: string) => {
  const match = shardArg.match(/^(\d+)\/(\d+)$/);
  const current = Number(match?.[1]);
  const total = Number(match?.[2]);
  if (!match || current < 1 || current > total) {
    throw new Error(`shard must be <current>/<total>, not ${shardArg}`);
  }
  const fallback = (reason: string) => {
    console.error(`e2e-shards: ${reason}; using Playwright's --shard`);
    console.log(`--shard=${current}/${total}`);
  };
  let timings: Timings;
  try {
    timings = parseTimings(readFileSync(timingsPath, "utf8"));
  } catch (error) {
    return fallback(`no usable timings (${(error as Error).message})`);
  }
  const shards = packShards(listSpecFiles(PROJECTS), timings, total);
  if (!shards) return fallback("too few spec files for the shards");
  const mine = shards[current - 1];
  const seconds = mine.reduce((sum, file) => sum + (timings[file] ?? 0), 0);
  console.error(
    `e2e-shards: shard ${current}/${total}: ${mine.length} files, about ${Math.round(seconds)} s of tests`,
  );
  writeFileSync(listPath, `${mine.join("\n")}\n`);
  console.log(`--test-list=${listPath}`);
};

if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "plan" && args.length === 3) {
    plan(args[0], args[1], args[2]);
  } else if (command === "timings" && args.length === 2) {
    const report = JSON.parse(readFileSync(args[0], "utf8"));
    writeFileSync(
      args[1],
      `${JSON.stringify(timingsFromReport(report), null, 2)}\n`,
    );
  } else {
    console.error(
      "usage: e2e-shards.ts plan <n>/<total> <timings.json> <list.txt>\n" +
        "       e2e-shards.ts timings <report.json> <timings.json>",
    );
    process.exit(2);
  }
}
