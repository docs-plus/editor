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

  it("(re)starts editor-purge from the file with its env", () => {
    expect(deployScript).toContain(
      "pm2 startOrRestart ecosystem.config.cjs --only editor-purge --update-env",
    );
  });
});

describe("Deploy workflow", () => {
  const workflow = parse(
    readFileSync(path.join(ROOT, ".github/workflows/deploy.yml"), "utf8"),
  ) as {
    on: Record<string, { workflows?: string[]; branches?: string[] }>;
    jobs: { deploy: { if: string } };
  };

  it("deploys automatically after CI on main and keeps the manual path", () => {
    expect(workflow.on.workflow_run?.workflows).toEqual(["CI"]);
    expect(workflow.on.workflow_run?.branches).toEqual(["main"]);
    expect(workflow.on).toHaveProperty("workflow_dispatch");
  });

  it("gates only the automatic path on the AUTO_DEPLOY kill switch", () => {
    const condition = workflow.jobs.deploy.if;
    expect(condition).toContain("vars.AUTO_DEPLOY != 'off'");
    expect(condition).toMatch(
      /^github\.event_name == 'workflow_dispatch' \|\|/,
    );
  });
});
