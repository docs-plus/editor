import { describe, expect, it } from "bun:test";

import {
  compareReports,
  mergeReports,
  parseJunit,
} from "../../../scripts/compare-unit-runs";

const report = (
  files: [string, number, number, number][],
  time = 1.5,
) => `<?xml version="1.0" encoding="UTF-8"?>
<testsuites name="bun test" tests="0" failures="0" skipped="0" time="${time}">
${files
  .map(
    ([file, tests, failures, skipped]) =>
      `  <testsuite name="${file}" file="${file}" tests="${tests}" failures="${failures}" skipped="${skipped}" time="0.1">
    <testsuite name="nested" file="${file}" tests="999" failures="999" skipped="0" time="0.1">
    </testsuite>
  </testsuite>`,
  )
  .join("\n")}
</testsuites>`;

describe("parseJunit", () => {
  it("counts each file's top-level suite only", () => {
    const parsed = parseJunit(
      report([
        ["tests/unit/a.test.ts", 5, 1, 1],
        ["tests/unit/b.test.ts", 2, 0, 0],
      ]),
    );
    expect(parsed.seconds).toBe(1.5);
    expect(parsed.files.get("tests/unit/a.test.ts")).toEqual({
      passed: 3,
      failed: 1,
      skipped: 1,
    });
    expect(parsed.files.get("tests/unit/b.test.ts")).toEqual({
      passed: 2,
      failed: 0,
      skipped: 0,
    });
    expect(parsed.files.size).toBe(2);
  });
});

describe("compareReports", () => {
  const serial = parseJunit(
    report([
      ["tests/unit/a.test.ts", 5, 0, 0],
      ["tests/unit/b.test.ts", 2, 0, 0],
    ]),
  );

  it("finds nothing when every file matches", () => {
    const parallel = parseJunit(
      report([
        ["tests/unit/b.test.ts", 2, 0, 0],
        ["tests/unit/a.test.ts", 5, 0, 0],
      ]),
    );
    expect(compareReports(serial, parallel)).toEqual([]);
  });

  it("reports a file whose counts differ", () => {
    const parallel = parseJunit(
      report([
        ["tests/unit/a.test.ts", 5, 1, 0],
        ["tests/unit/b.test.ts", 2, 0, 0],
      ]),
    );
    expect(compareReports(serial, parallel)).toEqual([
      "tests/unit/a.test.ts: serial 5 passed, 0 failed, 0 skipped; parallel 4 passed, 1 failed, 0 skipped",
    ]);
  });

  it("reports a file only one run has", () => {
    const parallel = parseJunit(report([["tests/unit/a.test.ts", 5, 0, 0]]));
    expect(compareReports(serial, parallel)).toEqual([
      "tests/unit/b.test.ts: serial 2 passed, 0 failed, 0 skipped; parallel missing",
    ]);
  });
});

describe("mergeReports", () => {
  it("joins runs over different files into one report", () => {
    const merged = mergeReports([
      parseJunit(report([["tests/unit/a.test.ts", 5, 0, 0]], 2)),
      parseJunit(report([["tests/unit/b.test.ts", 2, 1, 0]], 3)),
    ]);
    expect(merged.seconds).toBe(5);
    expect([...merged.files.keys()].sort()).toEqual([
      "tests/unit/a.test.ts",
      "tests/unit/b.test.ts",
    ]);
    expect(merged.files.get("tests/unit/b.test.ts")?.failed).toBe(1);
  });
});
