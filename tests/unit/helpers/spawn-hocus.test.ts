import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import path from "node:path";

import { spawnHocus } from "@/tests/helpers/spawn-hocus";

const TIMEOUT_MS = 40_000;
const HELPER = path.resolve(import.meta.dir, "../../helpers/spawn-hocus.ts");

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntilGone(pid: number, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid)) {
    if (Date.now() > deadline) {
      process.kill(pid, "SIGKILL");
      throw new Error(`hocus-server ${pid} outlived its parent`);
    }
    await Bun.sleep(100);
  }
}

/** A parent process that spawns a server, prints its pid, then waits. */
async function spawnParent() {
  const script = `
    const { spawnHocus } = await import(${JSON.stringify(HELPER)});
    const server = await spawnHocus();
    console.log("HOCUS_PID=" + server.pid);
    await Bun.sleep(60_000);
  `;
  const parent = Bun.spawn(["bun", "-e", script], {
    stdout: "pipe",
    stderr: "inherit",
  });
  let output = "";
  const decoder = new TextDecoder();
  for await (const chunk of parent.stdout) {
    output += decoder.decode(chunk, { stream: true });
    const match = /HOCUS_PID=(\d+)/.exec(output);
    if (match) return { parent, pid: Number(match[1]) };
  }
  throw new Error(`parent exited without a server:\n${output}`);
}

describe("spawnHocus cleanup", () => {
  it(
    "stops the server when its parent is killed outright",
    async () => {
      const { parent, pid } = await spawnParent();
      expect(isAlive(pid)).toBe(true);
      parent.kill("SIGKILL");
      await parent.exited;
      await waitUntilGone(pid);
    },
    TIMEOUT_MS,
  );

  it(
    "stops the server when its parent is terminated",
    async () => {
      const { parent, pid } = await spawnParent();
      parent.kill("SIGTERM");
      await parent.exited;
      await waitUntilGone(pid);
    },
    TIMEOUT_MS,
  );

  it(
    "removes its own temp database on stop",
    async () => {
      const server = await spawnHocus();
      const dir = path.dirname(server.dbPath);
      expect(existsSync(dir)).toBe(true);
      await server.stop();
      expect(existsSync(dir)).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    "kills a server that does not stop in time",
    async () => {
      const server = await spawnHocus();
      process.kill(server.pid, "SIGSTOP"); // frozen: ignores SIGTERM
      const started = Date.now();
      await server.stop({ timeoutMs: 300 });
      expect(Date.now() - started).toBeLessThan(5000);
      expect(isAlive(server.pid)).toBe(false);
    },
    TIMEOUT_MS,
  );
});
