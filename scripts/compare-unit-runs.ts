// Compares two `bun test --reporter=junit` reports file by file: the serial
// unit-test gate and the `--parallel` shadow run in CI. Exits 1 when any
// file's passed, failed or skipped count differs, so the shadow step shows
// the mismatch (it is continue-on-error until it is promoted).
//
//   bun scripts/compare-unit-runs.ts serial.xml parallel.xml

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

const total = (report: Report) =>
  [...report.files.values()].reduce((sum, file) => sum + file.passed, 0);

if (import.meta.main) {
  const [serialPath, parallelPath] = process.argv.slice(2);
  if (!serialPath || !parallelPath) {
    console.error("usage: compare-unit-runs.ts <serial.xml> <parallel.xml>");
    process.exit(2);
  }
  const serial = parseJunit(readFileSync(serialPath, "utf8"));
  const parallel = parseJunit(readFileSync(parallelPath, "utf8"));
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
