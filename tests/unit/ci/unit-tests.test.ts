import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { plan, SERIAL_FILES, STRESS } from "../../../scripts/unit-tests";

const ROOT = process.cwd();

const testFiles = (dir: string): string[] =>
  readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap(
    (entry) => {
      const relative = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return testFiles(relative);
      return /\.test\.tsx?$/.test(entry.name) ? [relative] : [];
    },
  );

// Reads a clock and asserts an upper bound: a wall-clock budget, which
// --parallel can blow by sharing the CPU with other files.
const CLOCK = /performance\.now\(\)|Date\.now\(\)|Bun\.nanoseconds\(\)/;
const BUDGET = /toBeLessThan(OrEqual)?\(/;

describe("scripts/unit-tests.ts", () => {
  it("lists files that exist", () => {
    for (const file of SERIAL_FILES) {
      expect(existsSync(path.join(ROOT, file)), file).toBe(true);
    }
  });

  it("runs every unit test with a wall-clock budget serially", () => {
    const timed = testFiles("tests/unit")
      .filter((file) => !file.startsWith("tests/unit/stress/"))
      .filter((file) => {
        const source = readFileSync(path.join(ROOT, file), "utf8");
        return CLOCK.test(source) && BUDGET.test(source);
      });
    expect(timed.sort()).toEqual([...SERIAL_FILES].sort());
  });

  it("runs the rest in parallel, then the timed files serially", () => {
    const [parallel, serial] = plan(false);
    expect(parallel).toContain("--parallel");
    expect(parallel).toContain(`--path-ignore-patterns=${STRESS}`);
    for (const file of SERIAL_FILES) {
      expect(parallel).toContain(`--path-ignore-patterns=${file}`);
      expect(serial).toContain(file);
    }
    expect(serial).not.toContain("--parallel");
  });

  it("runs everything serially with UNIT_SERIAL", () => {
    const runs = plan(true);
    expect(runs).toHaveLength(1);
    expect(runs[0]).not.toContain("--parallel");
    expect(runs[0]).toContain(`--path-ignore-patterns=${STRESS}`);
  });

  it("writes JUnit reports when asked", () => {
    const [parallel, serial] = plan(false, "/tmp/x");
    expect(parallel).toContain("--reporter-outfile=/tmp/x/parallel.xml");
    expect(serial).toContain("--reporter-outfile=/tmp/x/serial.xml");
    expect(plan(true, "/tmp/x")[0]).toContain(
      "--reporter-outfile=/tmp/x/all.xml",
    );
  });
});
