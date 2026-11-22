// The unit tests as CI runs them (tests/TESTING.md, "CI"): every file with
// `bun test --parallel`, except the ones that assert a wall-clock budget,
// which then run serially so no other file competes for the CPU.
//
//   bun scripts/unit-tests.ts [--junit <dir>]
//
// UNIT_SERIAL=1 runs everything serially instead (`bun run test`), the
// fallback if the parallel runner misbehaves. With --junit, each run writes
// a JUnit report into <dir> (parallel.xml and serial.xml, or all.xml).
// The stress probe (tests/unit/stress) is never included; it runs nightly.

/**
 * Unit test files that read the clock and assert a duration. Under
 * --parallel they share the CPU with other files and can miss their
 * budget, so they run serially. tests/unit/ci/unit-tests.test.ts fails on
 * a timing test missing from this list.
 */
export const SERIAL_FILES = [
  "tests/unit/components/bubble-controller.test.ts",
  "tests/unit/extensions/find/find-hits.test.ts",
  "tests/unit/helpers/spawn-hocus.test.ts",
  "tests/unit/lib/markdown-parse.test.ts",
  "tests/unit/lib/security/hocus-document-guard.test.ts",
] as const;

export const STRESS = "tests/unit/stress/**";

const junit = (dir: string | undefined, name: string) =>
  dir ? ["--reporter=junit", `--reporter-outfile=${dir}/${name}.xml`] : [];

/** The `bun test` invocations, in order. */
export const plan = (serialOnly: boolean, junitDir?: string): string[][] =>
  serialOnly
    ? [
        [
          "bun",
          "test",
          `--path-ignore-patterns=${STRESS}`,
          ...junit(junitDir, "all"),
        ],
      ]
    : [
        [
          "bun",
          "test",
          "--parallel",
          `--path-ignore-patterns=${STRESS}`,
          ...SERIAL_FILES.map((file) => `--path-ignore-patterns=${file}`),
          ...junit(junitDir, "parallel"),
        ],
        ["bun", "test", ...junit(junitDir, "serial"), ...SERIAL_FILES],
      ];

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--junit");
  const junitDir = at >= 0 ? args[at + 1] : undefined;
  const serialOnly = process.env.UNIT_SERIAL === "1";
  if (serialOnly) console.log("UNIT_SERIAL=1: running every file serially");
  let failed = false;
  // Both runs always go: a failure in the first still reports the second.
  for (const command of plan(serialOnly, junitDir)) {
    console.log(`$ ${command.join(" ")}`);
    const result = Bun.spawnSync(command, {
      stdout: "inherit",
      stderr: "inherit",
    });
    if (result.exitCode !== 0) failed = true;
  }
  process.exit(failed ? 1 : 0);
}
