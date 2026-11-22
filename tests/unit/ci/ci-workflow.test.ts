import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "yaml";

// The CI workflow's shape that branch protection, the merge queue and the
// Deploy workflow depend on (docs/operations/deploy-runbook.md).

interface Step {
  "continue-on-error"?: boolean;
  id?: string;
  name?: string;
  if?: string;
  run?: string;
}

interface Job {
  name?: string;
  if?: string;
  needs?: string | string[];
  strategy?: { "fail-fast"?: boolean; matrix?: { shard?: number[] } };
  steps?: Step[];
}

interface Workflow {
  on: Record<string, unknown>;
  concurrency: { group: string; "cancel-in-progress": string | boolean };
  jobs: Record<string, Job>;
}

const workflow = parse(
  readFileSync(path.resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8"),
) as Workflow;
const { jobs } = workflow;

// Ruleset required checks: renaming either breaks every open pull request.
const REQUIRED_CHECKS = [
  "Lint, typecheck, unit tests, build",
  "Playwright (Chromium)",
];

const needsOf = (job: Job) =>
  job.needs === undefined
    ? []
    : Array.isArray(job.needs)
      ? job.needs
      : [job.needs];

const runOf = (job: Job, name: string) =>
  job.steps?.find((step) => step.name === name)?.run ?? "";

describe("CI workflow", () => {
  it("runs in the merge queue, on pull requests and on pushes to main", () => {
    expect(Object.keys(workflow.on)).toEqual(
      expect.arrayContaining(["pull_request", "merge_group", "push"]),
    );
  });

  it("cancels superseded runs on pull requests only, never on main", () => {
    expect(workflow.concurrency["cancel-in-progress"]).toBe(
      `\${{ github.event_name == 'pull_request' }}`,
    );
    // Per ref, not per commit: main runs finish in commit order, so an older
    // commit can never deploy after a newer one.
    expect(workflow.concurrency.group).not.toContain("github.sha");
  });

  it("keeps each required check name on exactly one job", () => {
    const names = Object.values(jobs).map((job) => job.name);
    for (const check of REQUIRED_CHECKS) {
      expect(names.filter((name) => name === check)).toHaveLength(1);
    }
  });

  it("shards the chromium project and reports every shard", () => {
    const e2e = jobs.e2e;
    expect(e2e.strategy?.matrix?.shard).toEqual([1, 2, 3]);
    expect(e2e.strategy?.["fail-fast"]).toBe(false);
    const run = runOf(e2e, "Run Playwright");
    expect(run).toContain("--project=chromium");
    expect(run).toContain(`--shard=\${{ matrix.shard }}/3`);
    expect(run).toContain("--retries=1");
    expect(run).toContain("blob");
  });

  it("runs perf alone, without re-running chromium as its dependency", () => {
    const run = runOf(jobs.perf, "Run Playwright");
    expect(run).toContain("--project=perf");
    expect(run).toContain("--no-deps");
    expect(run).not.toContain("--project=chromium");
  });

  it("gates on every shard and perf, even when they fail or skip", () => {
    const gate = Object.values(jobs).find(
      (job) => job.name === "Playwright (Chromium)",
    );
    expect(gate).toBeDefined();
    // A skipped required check counts as passing.
    expect(gate?.if).toBe("always()");
    expect(needsOf(gate as Job)).toEqual(
      expect.arrayContaining(["changes", "e2e", "perf"]),
    );
    const verdict = gate?.steps?.find((step) => step.name === "Verdict");
    expect(verdict?.if).toBe("always()");
  });

  it("gates on the serial unit tests; the parallel run is a shadow", () => {
    const steps = jobs.checks.steps ?? [];
    const serial = steps.find((step) => step.name === "Unit tests");
    const shadow = steps.find(
      (step) => step.name === "Unit tests, parallel (shadow)",
    );
    expect(serial?.run).toContain("bun run test");
    expect(serial?.run).not.toContain("--parallel");
    expect(serial?.["continue-on-error"]).toBeUndefined();
    expect(shadow?.run).toContain("bun test --parallel");
    expect(shadow?.run).toContain("tests/unit/stress/**");
    expect(shadow?.run).toContain("scripts/compare-unit-runs.ts");
    expect(shadow?.["continue-on-error"]).toBe(true);
    expect(steps.indexOf(shadow as Step)).toBeGreaterThan(
      steps.indexOf(serial as Step),
    );
  });

  it("skips the browser suites only through the changes job", () => {
    for (const name of ["e2e", "perf"]) {
      expect(needsOf(jobs[name])).toContain("changes");
      expect(jobs[name].if).toBe("needs.changes.outputs.e2e == 'true'");
    }
    expect(jobs.checks.if).toBeUndefined();
  });
});

describe("Verdict step", () => {
  const gate = Object.values(jobs).find(
    (job) => job.name === "Playwright (Chromium)",
  ) as Job;
  const script = runOf(gate, "Verdict");

  const verdict = (
    CHANGES: string,
    RUN_E2E: string,
    SHARDS: string,
    PERF: string,
  ) =>
    Bun.spawnSync(["bash", "-e", "-c", script], {
      env: { PATH: process.env.PATH ?? "", CHANGES, RUN_E2E, SHARDS, PERF },
    }).exitCode;

  // [label, changes result, e2e output, shards result, perf result, exit]
  const cases: [string, string, string, string, string, number][] = [
    ["all passed", "success", "true", "success", "success", 0],
    ["docs only", "success", "false", "skipped", "skipped", 0],
    ["a shard failed", "success", "true", "failure", "success", 1],
    ["perf failed", "success", "true", "success", "failure", 1],
    ["shards cancelled", "success", "true", "cancelled", "success", 1],
    [
      "suites skipped though required",
      "success",
      "true",
      "skipped",
      "skipped",
      1,
    ],
    ["changes job failed", "failure", "", "skipped", "skipped", 1],
  ];

  it.each(cases)("%s", (_label, changes, runE2e, shards, perf, exitCode) => {
    expect(verdict(changes, runE2e, shards, perf)).toBe(exitCode);
  });
});

describe("docs-only decision", () => {
  const script = runOf(jobs.changes, "Decide");
  const dir = mkdtempSync(path.join(tmpdir(), "ci-decide-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const decide = (files: string[], event = "pull_request") => {
    const list = path.join(dir, "files.txt");
    const output = path.join(dir, "output.txt");
    writeFileSync(list, files.map((file) => `${file}\n`).join(""));
    writeFileSync(output, "");
    const result = Bun.spawnSync(["bash", "-e", "-c", script], {
      env: {
        PATH: process.env.PATH ?? "",
        EVENT: event,
        FILES: list,
        GITHUB_OUTPUT: output,
      },
    });
    expect(result.exitCode).toBe(0);
    return readFileSync(output, "utf8").trim();
  };

  it("skips for docs and Markdown only", () => {
    expect(decide(["docs/operations/deploy-runbook.md"])).toBe("e2e=false");
    expect(decide(["CHANGELOG.md", "tests/TESTING.md", "README.md"])).toBe(
      "e2e=false",
    );
    expect(decide(["docs/superpowers/specs/diagram.png"])).toBe("e2e=false");
  });

  it("runs when any other file changes", () => {
    expect(decide(["CHANGELOG.md", "lib/utils.ts"])).toBe("e2e=true");
    expect(decide([".github/workflows/ci.yml"])).toBe("e2e=true");
    expect(decide(["docs.ts"])).toBe("e2e=true");
    expect(decide(["README.mdx"])).toBe("e2e=true");
  });

  it("runs for desktop changes, Markdown included", () => {
    expect(decide(["desktop/main/index.ts"])).toBe("e2e=true");
    expect(decide(["desktop/README.md"])).toBe("e2e=true");
  });

  it("runs for an empty list and outside pull requests", () => {
    expect(decide([])).toBe("e2e=true");
    expect(decide(["docs/x.md"], "push")).toBe("e2e=true");
    expect(decide(["docs/x.md"], "merge_group")).toBe("e2e=true");
    expect(decide(["docs/x.md"], "workflow_dispatch")).toBe("e2e=true");
  });
});
