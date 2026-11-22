/**
 * scripts/deploy.sh refuses a commit whose .tool-versions pins another Bun
 * than the host's, before it creates the build checkout or restarts
 * anything. Runs the real script against a throwaway origin and live
 * checkout, with stub `bun`, `bunx` and `flock` (macOS has no flock).
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(process.cwd(), "scripts/deploy.sh");

let root: string;
let live: string;
let stubs: string;

const git = (cwd: string, ...args: string[]) => {
  const result = Bun.spawnSync(
    ["git", "-c", "user.name=t", "-c", "user.email=t@example.com", ...args],
    {
      cwd,
    },
  );
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  return result.stdout.toString().trim();
};

const stub = (name: string, body: string) => {
  const file = path.join(stubs, name);
  writeFileSync(file, `#!/bin/sh\n${body}\n`);
  chmodSync(file, 0o755);
};

/** Commits `.tool-versions` with `content` on the live checkout's main, pushes it and returns its SHA. */
const commitToolVersions = (content: string) => {
  writeFileSync(path.join(live, ".tool-versions"), content);
  git(live, "add", ".tool-versions");
  git(live, "commit", "-q", "--allow-empty", "-m", "pin bun");
  git(live, "push", "-q", "origin", "HEAD:main");
  return git(live, "rev-parse", "HEAD");
};

/** Runs the copied deploy.sh with a stub `bun` that reports `hostBun`. */
const deploy = (sha: string, hostBun: string) => {
  // Any other bun command fails, so a run that passes the check stops at its install.
  stub(
    "bun",
    `[ "$1" = "--version" ] && { echo ${hostBun}; exit 0; }\nexit 42`,
  );
  return Bun.spawnSync(["bash", path.join(live, "scripts/deploy.sh"), sha], {
    env: {
      HOME: path.join(root, "home"),
      PATH: `${stubs}:${process.env.PATH ?? ""}`,
    },
  });
};

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "deploy-bun-"));
  live = path.join(root, "app");
  stubs = path.join(root, "stubs");
  mkdirSync(stubs);
  stub("bunx", "exit 0");
  stub("flock", "exit 0");

  const origin = path.join(root, "origin.git");
  git(root, "init", "-q", "--bare", "-b", "main", origin);
  git(root, "clone", "-q", origin, live);
  git(live, "symbolic-ref", "HEAD", "refs/heads/main");
  mkdirSync(path.join(live, "scripts"));
  copyFileSync(SCRIPT, path.join(live, "scripts/deploy.sh"));
  git(live, "add", "scripts/deploy.sh");
  commitToolVersions("bun 1.4.5\n");
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scripts/deploy.sh Bun version check", () => {
  it("refuses a commit that pins another Bun, before the build", () => {
    const sha = commitToolVersions("bun 1.4.6\n");
    const result = deploy(sha, "1.4.5");
    expect(result.exitCode).toBe(11);
    expect(result.stderr.toString()).toContain(
      "needs Bun 1.4.6; this host has 1.4.5",
    );
    expect(existsSync(path.join(root, "editor-build"))).toBe(false);
  });

  it("refuses a commit without a bun line in .tool-versions", () => {
    const sha = commitToolVersions("nodejs 22.0.0\n");
    const result = deploy(sha, "1.4.5");
    expect(result.exitCode).toBe(11);
    expect(result.stderr.toString()).toContain("no bun line in .tool-versions");
  });

  it("goes on to the build when the host runs the pinned Bun", () => {
    const sha = git(live, "rev-parse", "HEAD");
    const result = deploy(sha, "1.4.5");
    const stderr = result.stderr.toString();
    expect(stderr).not.toContain("needs Bun");
    // The stub bun fails the build checkout's install, and the cleanup trap removes it.
    expect(result.stdout.toString()).toContain(`Building ${sha.slice(0, 7)}`);
    expect(result.exitCode).toBe(42);
    expect(existsSync(path.join(root, "editor-build"))).toBe(false);
  });
});
