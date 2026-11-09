// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type Permissions = string | Record<string, string> | undefined;

interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface Job {
  permissions?: Permissions;
  steps?: Step[];
}

interface Workflow {
  permissions?: Permissions;
  jobs: Record<string, Job>;
}

const WORKFLOWS_DIR = path.resolve(process.cwd(), ".github/workflows");
const WORKFLOW_FILES = readdirSync(WORKFLOWS_DIR).filter((f) =>
  /\.ya?ml$/.test(f),
);

// Commands that execute (or install) third-party package code.
const RUNS_DEPENDENCIES = /\bbun (install|update|run (test|build|lint))\b/;
const PINNED_USES = /@[0-9a-f]{40}( #.*)?$/;

const readWorkflow = (file: string) => {
  const source = readFileSync(path.join(WORKFLOWS_DIR, file), "utf8");
  return { source, workflow: parse(source) as Workflow };
};

const isReadOnly = (permissions: Permissions) => {
  if (permissions === undefined) return false;
  if (typeof permissions === "string") return permissions === "read-all";
  return Object.values(permissions).every((level) => level !== "write");
};

const grantsWrite = (permissions: Permissions, scope: string) => {
  if (permissions === "write-all") return true;
  if (typeof permissions !== "object") return false;
  return permissions[scope] === "write";
};

const runsDependencies = (job: Job) =>
  (job.steps ?? []).some((step) => RUNS_DEPENDENCIES.test(step.run ?? ""));

describe.each(WORKFLOW_FILES)("workflow %s", (file) => {
  const { source, workflow } = readWorkflow(file);
  const jobs = Object.entries(workflow.jobs);

  it("defaults the token to read-only at the top level", () => {
    expect(isReadOnly(workflow.permissions)).toBe(true);
  });

  it("never gives write tokens to jobs that install or run dependencies", () => {
    for (const [name, job] of jobs) {
      if (!runsDependencies(job)) continue;
      expect(
        job.permissions,
        `${name} must set explicit permissions`,
      ).toBeDefined();
      expect(grantsWrite(job.permissions, "contents"), name).toBe(false);
      expect(grantsWrite(job.permissions, "pull-requests"), name).toBe(false);
    }
  });

  it("does not persist git credentials in jobs that run dependencies", () => {
    for (const [name, job] of jobs) {
      if (!runsDependencies(job)) continue;
      for (const step of job.steps ?? []) {
        if (!step.uses?.startsWith("actions/checkout@")) continue;
        expect(step.with?.["persist-credentials"], name).toBe(false);
      }
    }
  });

  it("pins every action to a full commit SHA", () => {
    const uses = source
      .split("\n")
      .map((line) => line.match(/^\s*(?:-\s+)?uses:\s*(.+?)\s*$/)?.[1])
      .filter((value): value is string => value !== undefined);

    expect(uses.length).toBeGreaterThan(0);
    for (const ref of uses) {
      expect(ref).toMatch(PINNED_USES);
    }
  });
});
