import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { parse } from "yaml";

type Permissions = string | Record<string, string> | undefined;

interface Step {
  uses?: string;
  run?: string;
  with?: Record<string, unknown>;
}

interface Job {
  if?: string;
  permissions?: Permissions;
  steps?: Step[];
}

interface Workflow {
  on?: Record<string, unknown> | string | string[];
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
// A local reusable workflow resolves at the caller's own commit.
const LOCAL_WORKFLOW = /^\.\/\.github\/workflows\/[\w.-]+\.ya?ml$/;

const isPinned = (ref: string) =>
  LOCAL_WORKFLOW.test(ref) || PINNED_USES.test(ref);

const actionRefs = (source: string): string[] =>
  source
    .split("\n")
    .map((line) => line.match(/^\s*(?:-\s+)?uses:\s*(.+?)\s*$/)?.[1])
    .filter((value): value is string => value !== undefined);

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
    for (const ref of actionRefs(source)) {
      expect(isPinned(ref), ref).toBe(true);
    }
  });
});

const triggers = (workflow: Workflow): string[] => {
  const on = workflow.on;
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on ?? {});
};

const WORKFLOW_RUN_FILES = WORKFLOW_FILES.filter((file) =>
  triggers(readWorkflow(file).workflow).includes("workflow_run"),
);

// A workflow_run workflow runs with secrets after another workflow, which may
// have run for a pull request from a fork. It must never run that code, and
// must only act on runs that came from a push.
describe.each(WORKFLOW_RUN_FILES)("workflow_run workflow %s", (file) => {
  const { workflow } = readWorkflow(file);
  const jobs = Object.entries(workflow.jobs);

  it("never checks out or runs repository code", () => {
    for (const [name, job] of jobs) {
      for (const step of job.steps ?? []) {
        expect(step.uses?.startsWith("actions/checkout@") ?? false, name).toBe(
          false,
        );
      }
      expect(runsDependencies(job), name).toBe(false);
    }
  });

  it("acts only on successful runs from a push", () => {
    for (const [name, job] of jobs) {
      const condition = job.if ?? "";
      expect(condition, name).toContain(
        "github.event.workflow_run.conclusion == 'success'",
      );
      expect(condition, name).toContain(
        "github.event.workflow_run.event == 'push'",
      );
    }
  });
});

it("finds the workflow_run workflows", () => {
  expect(WORKFLOW_RUN_FILES).toContain("deploy.yml");
});

// Pull request and merge queue runs build code nobody has merged yet (from a
// fork, for a pull request), so no job in them gets a write scope.
const UNTRUSTED_TRIGGER_FILES = WORKFLOW_FILES.filter((file) =>
  triggers(readWorkflow(file).workflow).some(
    (trigger) => trigger === "pull_request" || trigger === "merge_group",
  ),
);

describe.each(UNTRUSTED_TRIGGER_FILES)("pull request workflow %s", (file) => {
  const { workflow } = readWorkflow(file);

  it("gives every job explicit read-only permissions", () => {
    for (const [name, job] of Object.entries(workflow.jobs)) {
      expect(isReadOnly(job.permissions), name).toBe(true);
    }
  });
});

it("finds the pull request and merge queue workflows", () => {
  expect(UNTRUSTED_TRIGGER_FILES).toContain("ci.yml");
  expect(triggers(readWorkflow("ci.yml").workflow)).toContain("merge_group");
});

// A merge queue CI run is on a gh-readonly-queue/... branch and its event is
// merge_group: Deploy acts only on pushes to main (checked above), so the
// queue never deploys; the push that lands the merge does.
it("deploys only after CI on main", () => {
  const on = readWorkflow("deploy.yml").workflow.on as Record<
    string,
    { workflows?: string[]; branches?: string[] }
  >;
  expect(on.workflow_run.workflows).toEqual(["CI"]);
  expect(on.workflow_run.branches).toEqual(["main"]);
});

// A workflow may use no actions at all (release.yml only runs gh), but the
// parser above must still find the ones that exist.
it("finds the actions the workflows use", () => {
  const all = WORKFLOW_FILES.flatMap((file) =>
    actionRefs(readWorkflow(file).source),
  );
  expect(all.length).toBeGreaterThan(0);
});

it("accepts local reusable workflows and nothing unpinned", () => {
  expect(isPinned("./.github/workflows/desktop-smoke.yml")).toBe(true);
  expect(
    isPinned("actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7"),
  ).toBe(true);
  expect(isPinned("actions/checkout@v7")).toBe(false);
  expect(isPinned("./.github/actions/setup")).toBe(false);
  expect(isPinned("docs-plus/editor/.github/workflows/x.yml@main")).toBe(false);
});
