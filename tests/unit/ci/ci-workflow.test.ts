import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "yaml";

// The CI workflow's shape that branch protection, the merge queue and the
// Deploy workflow depend on (docs/operations/deploy-runbook.md).

interface Step {
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

  it("starts a full run when a draft is marked ready for review", () => {
    const pullRequest = workflow.on.pull_request as { types?: string[] };
    expect(pullRequest.types).toEqual(
      expect.arrayContaining([
        "opened",
        "synchronize",
        "reopened",
        "ready_for_review",
      ]),
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
    expect(run).toContain("--project=library");
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

  it("skips the browser suites only through the changes job", () => {
    for (const name of ["e2e", "perf", "desktop"]) {
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

  interface VerdictCase {
    label: string;
    event: string;
    changes: string;
    e2e: string;
    reason: string;
    shards: string;
    perf: string;
    exit: number;
  }

  const verdict = (c: VerdictCase) =>
    Bun.spawnSync(["bash", "-e", "-c", script], {
      env: {
        PATH: process.env.PATH ?? "",
        EVENT: c.event,
        CHANGES: c.changes,
        RUN_E2E: c.e2e,
        REASON: c.reason,
        SHARDS: c.shards,
        PERF: c.perf,
      },
    }).exitCode;

  const ran = { e2e: "true", reason: "", shards: "success", perf: "success" };
  const skipped = { shards: "skipped", perf: "skipped" };
  const pr = { event: "pull_request", changes: "success" };
  const cases: VerdictCase[] = [
    { label: "all passed", ...pr, ...ran, exit: 0 },
    {
      label: "all passed in the merge queue",
      ...ran,
      ...pr,
      event: "merge_group",
      exit: 0,
    },
    { label: "all passed on main", ...ran, ...pr, event: "push", exit: 0 },
    {
      label: "draft skips",
      ...pr,
      e2e: "false",
      reason: "draft",
      ...skipped,
      exit: 0,
    },
    {
      label: "docs-only skips",
      ...pr,
      e2e: "false",
      reason: "docs-only",
      ...skipped,
      exit: 0,
    },
    { label: "a shard failed", ...pr, ...ran, shards: "failure", exit: 1 },
    { label: "perf failed", ...pr, ...ran, perf: "failure", exit: 1 },
    { label: "shards cancelled", ...pr, ...ran, shards: "cancelled", exit: 1 },
    { label: "ready pull request skipped", ...pr, ...ran, ...skipped, exit: 1 },
    {
      label: "skip with no reason",
      ...pr,
      e2e: "false",
      reason: "",
      ...skipped,
      exit: 1,
    },
    {
      label: "skip with an unknown reason",
      ...pr,
      e2e: "false",
      reason: "other",
      ...skipped,
      exit: 1,
    },
    {
      label: "draft skip in the merge queue",
      ...pr,
      event: "merge_group",
      e2e: "false",
      reason: "draft",
      ...skipped,
      exit: 1,
    },
    {
      label: "draft skip on main",
      ...pr,
      event: "push",
      e2e: "false",
      reason: "draft",
      ...skipped,
      exit: 1,
    },
    {
      label: "docs-only skip on main",
      ...pr,
      event: "push",
      e2e: "false",
      reason: "docs-only",
      ...skipped,
      exit: 1,
    },
    {
      label: "skipped in a manual run",
      ...pr,
      event: "workflow_dispatch",
      e2e: "false",
      reason: "draft",
      ...skipped,
      exit: 1,
    },
    {
      label: "changes job failed",
      ...pr,
      changes: "failure",
      e2e: "",
      reason: "",
      ...skipped,
      exit: 1,
    },
  ];

  it.each(cases)("$label", (c) => {
    expect(verdict(c)).toBe(c.exit);
  });
});

describe("browser suites decision", () => {
  const script = runOf(jobs.changes, "Decide");
  const dir = mkdtempSync(path.join(tmpdir(), "ci-decide-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const RUN = "e2e=true skip-reason=";
  const DOCS_ONLY = "e2e=false skip-reason=docs-only";
  const DRAFT = "e2e=false skip-reason=draft";

  const decide = (files: string[], event = "pull_request", draft = "false") => {
    const list = path.join(dir, "files.txt");
    const output = path.join(dir, "output.txt");
    writeFileSync(list, files.map((file) => `${file}\n`).join(""));
    writeFileSync(output, "");
    const result = Bun.spawnSync(["bash", "-e", "-c", script], {
      env: {
        PATH: process.env.PATH ?? "",
        EVENT: event,
        DRAFT: draft,
        FILES: list,
        GITHUB_OUTPUT: output,
      },
    });
    expect(result.exitCode).toBe(0);
    return readFileSync(output, "utf8").trim().split("\n").join(" ");
  };

  it("skips for docs and Markdown only", () => {
    expect(decide(["docs/operations/deploy-runbook.md"])).toBe(DOCS_ONLY);
    expect(decide(["CHANGELOG.md", "tests/TESTING.md", "README.md"])).toBe(
      DOCS_ONLY,
    );
    expect(decide(["docs/superpowers/specs/diagram.png"])).toBe(DOCS_ONLY);
  });

  it("runs when any other file changes", () => {
    expect(decide(["CHANGELOG.md", "lib/utils.ts"])).toBe(RUN);
    expect(decide([".github/workflows/ci.yml"])).toBe(RUN);
    expect(decide(["docs.ts"])).toBe(RUN);
    expect(decide(["README.mdx"])).toBe(RUN);
  });

  it("runs for desktop changes, Markdown included", () => {
    expect(decide(["desktop/main/index.ts"])).toBe(RUN);
    expect(decide(["desktop/README.md"])).toBe(RUN);
  });

  it("skips for a draft, whatever it changes", () => {
    expect(decide(["lib/utils.ts"], "pull_request", "true")).toBe(DRAFT);
    expect(decide(["desktop/main/index.ts"], "pull_request", "true")).toBe(
      DRAFT,
    );
    expect(decide([], "pull_request", "true")).toBe(DRAFT);
  });

  it("never skips outside pull requests, even with a draft flag", () => {
    expect(decide(["lib/utils.ts"], "merge_group", "true")).toBe(RUN);
    expect(decide(["lib/utils.ts"], "push", "true")).toBe(RUN);
  });

  it("runs for an empty list and outside pull requests", () => {
    expect(decide([])).toBe(RUN);
    expect(decide(["docs/x.md"], "push")).toBe(RUN);
    expect(decide(["docs/x.md"], "merge_group")).toBe(RUN);
    expect(decide(["docs/x.md"], "workflow_dispatch")).toBe(RUN);
  });
});
