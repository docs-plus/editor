import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

// The CI workflow's shape that branch protection, the merge queue and the
// Deploy workflow depend on (docs/operations/deploy-runbook.md).

interface Job {
  name?: string;
}

interface Workflow {
  on: Record<string, unknown>;
  concurrency: { group: string; "cancel-in-progress": string | boolean };
  jobs: Record<string, Job>;
}

const workflow = parse(
  readFileSync(path.resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8"),
) as Workflow;

// Ruleset required checks: renaming either breaks every open pull request.
const REQUIRED_CHECKS = [
  "Lint, typecheck, unit tests, build",
  "Playwright (Chromium)",
];

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
    const names = Object.values(workflow.jobs).map((job) => job.name);
    for (const check of REQUIRED_CHECKS) {
      expect(names.filter((name) => name === check)).toHaveLength(1);
    }
  });
});
