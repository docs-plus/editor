/**
 * Production runs from ecosystem.config.cjs, and scripts/deploy.sh restarts
 * apps from it by name. The daily retention purge (editor-purge) must stay a
 * run-once cron job on the same database as the servers, and every app the
 * deploy names must exist in the file. The Deploy workflow's automatic path
 * must keep its kill switch.
 */
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import { parse } from "yaml";

import { DEPLOY_MARKER_NAME } from "@/scripts/purge-retention";

interface App {
  name: string;
  cwd?: string;
  script: string;
  args?: string;
  env?: Record<string, string | number>;
  cron_restart?: string;
  autorestart?: boolean;
}

const ROOT = process.cwd();
const require = createRequire(import.meta.url);
const { apps } = require(path.join(ROOT, "ecosystem.config.cjs")) as {
  apps: App[];
};
const app = (name: string) => {
  const found = apps.find((candidate) => candidate.name === name);
  if (!found) throw new Error(`${name} is not in ecosystem.config.cjs`);
  return found;
};
const deployScript = readFileSync(path.join(ROOT, "scripts/deploy.sh"), "utf8");

describe("ecosystem.config.cjs editor-purge", () => {
  const purge = app("editor-purge");

  it("runs the retention purge once a day and is not kept alive", () => {
    expect(purge.script).toBe("bun");
    expect(purge.args).toBe("scripts/purge-retention.ts");
    expect(existsSync(path.join(ROOT, "scripts/purge-retention.ts"))).toBe(
      true,
    );
    expect(purge.cwd).toBe(ROOT);
    expect(purge.cron_restart).toBe("17 3 * * *");
    expect(purge.autorestart).toBe(false);
  });

  // The first real purge permanently deletes documents: it stays a dry run
  // until the owner switches the file to on in a pull request.
  it("sets an explicit PURGE_MODE that never deletes without review", () => {
    expect(["off", "dry-run", "on"]).toContain(String(purge.env?.PURGE_MODE));
  });

  it("uses the same database and retention env as the servers", () => {
    const storageKeys = (env: App["env"] = {}) =>
      Object.keys(env).filter((key) => /^DB_PATH$|RETENTION/.test(key));
    for (const server of ["editor-hocus", "editor-next"]) {
      const env = app(server).env ?? {};
      for (const key of storageKeys(env)) {
        expect(purge.env?.[key], `${server} ${key}`).toBe(env[key]);
      }
    }
    expect(purge.env?.DB_PATH).toBe(app("editor-hocus").env?.DB_PATH);
  });
});

describe("scripts/deploy.sh PM2 commands", () => {
  const onlyNames = [...deployScript.matchAll(/--only (\S+)/g)].map(
    (match) => match[1],
  );

  it("names only apps that exist in ecosystem.config.cjs", () => {
    expect(onlyNames.length).toBeGreaterThan(0);
    for (const name of onlyNames) app(name);
  });

  // PM2 runs an app when it adds or restarts it. The marker, written next to
  // the database just before, makes that run exit: deploys never purge.
  it("registers editor-purge without purging", () => {
    const register =
      "pm2 startOrRestart ecosystem.config.cjs --only editor-purge --update-env";
    const marker = `date +%s > "$purge_marker"`;
    expect(deployScript).toContain(
      `purge_marker="$APP_DIR/${DEPLOY_MARKER_NAME}"`,
    );
    expect(deployScript).toContain(marker);
    expect(deployScript).toContain(register);
    expect(deployScript.indexOf(marker)).toBeLessThan(
      deployScript.indexOf(register),
    );
  });

  // The host's own node is Node 14; install scripts must run on Bun.
  it("installs only through install_deps, with Bun as node", () => {
    const installs = deployScript
      .split("\n")
      .filter((line) => /\bbun install\b/.test(line));
    expect(installs).toEqual([
      'install_deps() { HUSKY=0 PATH="$node_shim:$PATH" bun install --frozen-lockfile; }',
    ]);
    expect(deployScript).toContain(
      'ln -s "$(command -v bun)" "$node_shim/node"',
    );
    // Install before the env file is in the build checkout.
    expect(
      deployScript.indexOf('(cd "$BUILD_DIR" && install_deps)'),
    ).toBeLessThan(deployScript.indexOf('cp .env.production "$BUILD_DIR/"'));
  });

  // The script looks for the marker next to DB_PATH; deploy.sh writes it in
  // the app directory, PM2's cwd for editor-purge.
  it("keeps the database in the app directory, where the marker goes", () => {
    expect(String(app("editor-purge").env?.DB_PATH)).not.toContain("/");
  });
});

describe("Deploy workflow", () => {
  const workflow = parse(
    readFileSync(path.join(ROOT, ".github/workflows/deploy.yml"), "utf8"),
  ) as {
    on: Record<string, { workflows?: string[]; branches?: string[] }>;
    concurrency: { group: string; "cancel-in-progress": boolean };
    jobs: { deploy: { if: string } };
  };
  const squash = (text: string) => text.replace(/\s+/g, " ").trim();

  it("deploys automatically after CI on main and keeps the manual path", () => {
    expect(workflow.on.workflow_run?.workflows).toEqual(["CI"]);
    expect(workflow.on.workflow_run?.branches).toEqual(["main"]);
    expect(workflow.on).toHaveProperty("workflow_dispatch");
  });

  it("deploys automatically only once AUTO_DEPLOY is on", () => {
    const condition = workflow.jobs.deploy.if;
    expect(condition).toContain("vars.AUTO_DEPLOY == 'on'");
    expect(condition).not.toContain("AUTO_DEPLOY != ");
    expect(condition).toMatch(
      /^github\.event_name == 'workflow_dispatch' \|\|/,
    );
  });

  // Every CI completion on main starts a Deploy run. A skipped one in the
  // production group would cancel a deploy waiting its turn, so only runs
  // that pass the job's condition may join it.
  it("puts only runs that will deploy in the production group", () => {
    const group = squash(workflow.concurrency.group);
    expect(group).toBe(
      `\${{ (${squash(workflow.jobs.deploy.if)}) && 'deploy-production' || format('deploy-skipped-{0}', github.run_id) }}`,
    );
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  });
});
