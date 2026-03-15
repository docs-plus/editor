import { type ChildProcess, spawn } from "node:child_process";
import net from "node:net";
import { expect, test } from "@playwright/test";
import { EditorPage } from "../helpers/editor-page";

const HOCUS_PORT = 1235;
const HOCUS_DB = "db-soak-test.sqlite";

async function waitForPort(port: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port, host: "127.0.0.1" });
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => resolve(false));
    });
    if (reachable) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Port ${port} not reachable within ${timeoutMs}ms`);
}

function spawnHocuspocus(): ChildProcess {
  return spawn(
    "bunx",
    ["@hocuspocus/cli", "--port", String(HOCUS_PORT), "--sqlite", HOCUS_DB],
    { stdio: "pipe" },
  );
}

async function killProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };
    proc.on("exit", done);
    proc.kill("SIGTERM");
    setTimeout(() => {
      if (!proc.killed) proc.kill("SIGKILL");
      done();
    }, 3000);
  });
}

test.describe("yjs reconnection recovery", () => {
  let hocus: ChildProcess;

  test.afterEach(async () => {
    if (hocus) await killProcess(hocus);
    const fs = await import("node:fs");
    try {
      fs.unlinkSync(HOCUS_DB);
    } catch {
      /* ignore ENOENT */
    }
  });

  test("editor recovers from Hocuspocus restart without data loss", async ({
    page,
  }) => {
    hocus = spawnHocuspocus();
    await waitForPort(HOCUS_PORT);

    await page.addInitScript(
      `window.__HOCUS_URL = "ws://127.0.0.1:${HOCUS_PORT}"`,
    );

    const ep = new EditorPage(page);
    await ep.goto();
    await ep.waitForSync();

    await page.click(".tiptap");
    await ep.typeText("Hello before crash");
    await page.waitForTimeout(2000);

    await killProcess(hocus);
    await page.waitForTimeout(2000);

    await ep.typeText(" — offline edit");

    hocus = spawnHocuspocus();
    await waitForPort(HOCUS_PORT);
    await page.waitForTimeout(5000);

    const afterJson = await ep.getEditorJSON();
    const textContent = JSON.stringify(afterJson);
    expect(textContent).toContain("Hello before crash");
    expect(textContent).toContain("offline edit");
  });
});
