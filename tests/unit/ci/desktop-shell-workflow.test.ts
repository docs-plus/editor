import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { parse } from "yaml";

// The desktop shell workflow's shape that makes "Desktop shell (gate)" safe
// to require in the main ruleset (docs/operations/deploy-runbook.md): it
// runs on every pull request and in the merge queue, and fails closed.

interface Step {
  name?: string;
  run?: string;
}

interface Job {
  name?: string;
  if?: string;
  needs?: string | string[];
  steps?: Step[];
}

interface Workflow {
  on: Record<string, { paths?: string[]; types?: string[] } | null>;
  jobs: Record<string, Job>;
}

const workflow = parse(
  readFileSync(
    path.resolve(process.cwd(), ".github/workflows/desktop-shell.yml"),
    "utf8",
  ),
) as Workflow;
const { jobs } = workflow;

const GATE = "Desktop shell (gate)";

const needsOf = (job: Job) =>
  job.needs === undefined ? [] : [job.needs].flat();

const runOf = (job: Job, name: string) =>
  job.steps?.find((step) => step.name === name)?.run ?? "";

describe("desktop shell workflow", () => {
  it("runs on every pull request, in the merge queue, nightly and on demand", () => {
    expect(Object.keys(workflow.on)).toEqual(
      expect.arrayContaining([
        "pull_request",
        "merge_group",
        "workflow_call",
        "workflow_dispatch",
      ]),
    );
    // A paths filter would leave the required check missing on other PRs.
    expect(workflow.on.pull_request?.paths).toBeUndefined();
    expect(workflow.on.pull_request?.types).toEqual(
      expect.arrayContaining([
        "opened",
        "synchronize",
        "reopened",
        "ready_for_review",
      ]),
    );
  });

  it("names exactly one job as the gate, which always runs after the rest", () => {
    const gates = Object.values(jobs).filter((job) => job.name === GATE);
    expect(gates).toHaveLength(1);
    expect(gates[0].if).toBe("always()");
    expect(needsOf(gates[0])).toEqual(
      expect.arrayContaining(["changes", "renderer", "package"]),
    );
  });

  it("builds only when the changes job says so", () => {
    expect(needsOf(jobs.renderer)).toContain("changes");
    expect(jobs.renderer.if).toBe("needs.changes.outputs.build == 'true'");
    // package needs renderer, so it is skipped with it.
    expect(needsOf(jobs.package)).toContain("renderer");
  });
});

describe("desktop shell gate verdict", () => {
  const gate = Object.values(jobs).find((job) => job.name === GATE) as Job;
  const script = runOf(gate, "Verdict");

  interface VerdictCase {
    label: string;
    event: string;
    changes: string;
    build: string;
    reason: string;
    renderer: string;
    pkg: string;
    exit: number;
  }

  const verdict = (c: VerdictCase) =>
    Bun.spawnSync(["bash", "-e", "-c", script], {
      env: {
        PATH: process.env.PATH ?? "",
        EVENT: c.event,
        CHANGES: c.changes,
        BUILD: c.build,
        REASON: c.reason,
        RENDERER: c.renderer,
        PACKAGE: c.pkg,
      },
    }).exitCode;

  const built = {
    build: "true",
    reason: "",
    renderer: "success",
    pkg: "success",
  };
  const skipped = { renderer: "skipped", pkg: "skipped" };
  const pr = { event: "pull_request", changes: "success" };
  const cases: VerdictCase[] = [
    { label: "built and passed", ...pr, ...built, exit: 0 },
    {
      label: "built and passed in the merge queue",
      ...pr,
      ...built,
      event: "merge_group",
      exit: 0,
    },
    {
      label: "built and passed nightly",
      ...pr,
      ...built,
      event: "schedule",
      exit: 0,
    },
    {
      label: "draft skips",
      ...pr,
      build: "false",
      reason: "draft",
      ...skipped,
      exit: 0,
    },
    {
      label: "no shell paths skips",
      ...pr,
      build: "false",
      reason: "no-shell-changes",
      ...skipped,
      exit: 0,
    },
    {
      label: "a package leg failed",
      ...pr,
      ...built,
      pkg: "failure",
      exit: 1,
    },
    {
      label: "the renderer failed (package skipped)",
      ...pr,
      ...built,
      renderer: "failure",
      pkg: "skipped",
      exit: 1,
    },
    {
      label: "a package leg was cancelled",
      ...pr,
      ...built,
      pkg: "cancelled",
      exit: 1,
    },
    {
      label: "skipped though it had to build",
      ...pr,
      ...built,
      ...skipped,
      exit: 1,
    },
    {
      label: "skip with no reason",
      ...pr,
      build: "false",
      reason: "",
      ...skipped,
      exit: 1,
    },
    {
      label: "skip with an unknown reason",
      ...pr,
      build: "false",
      reason: "other",
      ...skipped,
      exit: 1,
    },
    {
      label: "skip in the merge queue",
      ...pr,
      event: "merge_group",
      build: "false",
      reason: "no-shell-changes",
      ...skipped,
      exit: 1,
    },
    {
      label: "draft skip nightly",
      ...pr,
      event: "schedule",
      build: "false",
      reason: "draft",
      ...skipped,
      exit: 1,
    },
    {
      label: "skip in a manual run",
      ...pr,
      event: "workflow_dispatch",
      build: "false",
      reason: "no-shell-changes",
      ...skipped,
      exit: 1,
    },
    {
      label: "changes job failed",
      ...pr,
      changes: "failure",
      build: "",
      reason: "",
      ...skipped,
      exit: 1,
    },
  ];

  it.each(cases)("$label", (c) => {
    expect(verdict(c)).toBe(c.exit);
  });
});

describe("desktop shell build decision", () => {
  const script = runOf(jobs.changes, "Decide");
  const dir = mkdtempSync(path.join(tmpdir(), "desktop-shell-decide-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const BUILD = "build=true skip-reason=";
  const NO_SHELL = "build=false skip-reason=no-shell-changes";
  const DRAFT = "build=false skip-reason=draft";

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

  // The paths filter this workflow had before it ran on every pull request.
  it.each([
    "desktop/main/index.ts",
    "lib/platform/desktop/dev-bridge.ts",
    "lib/security/content-security-policy.ts",
    "scripts/build-desktop.ts",
    "scripts/desktop-export.ts",
    "next.config.ts",
    "tests/electron/shell.spec.ts",
    "playwright.electron.config.ts",
    "package.json",
    "bun.lock",
    ".github/workflows/desktop-shell.yml",
  ])("builds for %s", (file) => {
    expect(decide(["README.md", file])).toBe(BUILD);
  });

  it.each([
    "lib/utils.ts",
    "lib/platform/web/global-tabs-index.ts",
    "components/document-editor/document-editor.tsx",
    "desktop.md",
    "tests/e2e/desktop-seams.spec.ts",
    "scripts/build-desktop.tsx",
    "next.config.ts.bak",
  ])("skips for %s alone", (file) => {
    expect(decide([file])).toBe(NO_SHELL);
  });

  it("skips a draft, whatever it changes", () => {
    expect(decide(["desktop/main/index.ts"], "pull_request", "true")).toBe(
      DRAFT,
    );
  });

  it("builds for an empty list and outside pull requests", () => {
    expect(decide([])).toBe(BUILD);
    for (const event of ["merge_group", "schedule", "workflow_dispatch"]) {
      expect(decide(["lib/utils.ts"], event, "true")).toBe(BUILD);
    }
  });
});
