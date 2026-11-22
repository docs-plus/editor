// Compares `bun test --reporter=junit` reports file by file: a fully serial
// run against the run CI does (scripts/unit-tests.ts: a parallel report and
// a serial one for the clock-budget files, merged). Exits 1 when any file's
// passed, failed or skipped count differs. Nightly runs it (unit-runs).
//
//   bun scripts/compare-unit-runs.ts serial.xml parallel.xml [more.xml …]

import { readFileSync } from "node:fs";

export interface FileCounts {
  passed: number;
  failed: number;
  skipped: number;
}

export interface Report {
  files: Map<string, FileCounts>;
  seconds: number;
}

const attr = (tag: string, name: string) =>
  tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

const count = (tag: string, name: string) => Number(attr(tag, name) ?? 0);

// Bun writes one top-level <testsuite> per file, indented two spaces, with
// nested suites (describe blocks) indented further.
export const parseJunit = (xml: string): Report => {
  const files = new Map<string, FileCounts>();
  for (const [tag] of xml.matchAll(/^ {2}<testsuite\s[^>]*>/gm)) {
    const file = attr(tag, "file") ?? attr(tag, "name") ?? "";
    const failed = count(tag, "failures") + count(tag, "errors");
    const skipped = count(tag, "skipped");
    files.set(file, {
      passed: count(tag, "tests") - failed - skipped,
      failed,
      skipped,
    });
  }
  const root = xml.match(/<testsuites\s[^>]*>/)?.[0] ?? "";
  return { files, seconds: count(root, "time") };
};

const show = (counts: FileCounts | undefined) =>
  counts
    ? `${counts.passed} passed, ${counts.failed} failed, ${counts.skipped} skipped`
    : "missing";

export const compareReports = (serial: Report, parallel: Report) => {
  const differences: string[] = [];
  const names = new Set([...serial.files.keys(), ...parallel.files.keys()]);
  for (const name of [...names].sort()) {
    const a = serial.files.get(name);
    const b = parallel.files.get(name);
    if (
      a?.passed !== b?.passed ||
      a?.failed !== b?.failed ||
      a?.skipped !== b?.skipped
    ) {
      differences.push(`${name}: serial ${show(a)}; parallel ${show(b)}`);
    }
  }
  return differences;
};

/** One report from several, as from runs over disjoint sets of files. */
export const mergeReports = (reports: Report[]): Report => ({
  files: new Map(reports.flatMap((report) => [...report.files])),
  seconds: reports.reduce((sum, report) => sum + report.seconds, 0),
});

const total = (report: Report) =>
  [...report.files.values()].reduce((sum, file) => sum + file.passed, 0);

if (import.meta.main) {
  const [serialPath, ...parallelPaths] = process.argv.slice(2);
  if (!serialPath || parallelPaths.length === 0) {
    console.error(
      "usage: compare-unit-runs.ts <serial.xml> <parallel.xml> [more.xml …]",
    );
    process.exit(2);
  }
  const serial = parseJunit(readFileSync(serialPath, "utf8"));
  const parallel = mergeReports(
    parallelPaths.map((path) => parseJunit(readFileSync(path, "utf8"))),
  );
  console.log(
    `serial: ${serial.files.size} files, ${total(serial)} passed, ${serial.seconds.toFixed(1)} s`,
  );
  console.log(
    `parallel: ${parallel.files.size} files, ${total(parallel)} passed, ${parallel.seconds.toFixed(1)} s`,
  );
  const differences = compareReports(serial, parallel);
  if (differences.length === 0) {
    console.log("Per-file counts match.");
  } else {
    for (const line of differences) console.log(`::warning::${line}`);
    console.log(`${differences.length} file(s) differ.`);
    process.exit(1);
  }
}
