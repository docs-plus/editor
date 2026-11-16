/**
 * Spike S4: Playwright `_electron` drives the packaged app across a relaunch.
 * The new document's text must come back from the origin's device copy
 * (lib/offline/) while Hocus is down, then sync once Hocus is back.
 *
 *   bun spikes/s4-electron-e2e/stage.ts && (cd spikes/s4-electron-e2e && bun electron-builder --dir --publish never)
 *   CI= bun playwright test -c spikes/s4-electron-e2e/playwright.config.ts
 */
import { appendFileSync, existsSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  _electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from "@playwright/test";

const ROOT = resolve(__dirname, "../..");
const RELEASE = join(__dirname, "release");
const PORT = process.env.S4_HOCUS_PORT ?? "1294";
const TEXT = "S4 persists 日本語";
const EVIDENCE = join(__dirname, "evidence", process.platform);
mkdirSync(EVIDENCE, { recursive: true });

function packagedBinary(): string {
  const candidates =
    process.platform === "darwin"
      ? [
          `mac-${process.arch}/TinyDocy.app/Contents/MacOS/TinyDocy`,
          "mac/TinyDocy.app/Contents/MacOS/TinyDocy",
        ]
      : process.platform === "win32"
        ? ["win-unpacked/TinyDocy.exe", "win-arm64-unpacked/TinyDocy.exe"]
        : ["linux-unpacked/tinydocy", "linux-arm64-unpacked/tinydocy"];
  const found = candidates
    .map((c) => join(RELEASE, c))
    .find((p) => existsSync(p));
  if (!found) throw new Error(`no packaged binary under ${RELEASE}`);
  return found;
}

async function startHocus(dbPath: string) {
  const proc = Bun.spawn(["bun", "scripts/hocus-server.ts"], {
    cwd: ROOT,
    stdout: "ignore",
    stderr: "ignore",
    env: {
      ...process.env,
      DB_PATH: dbPath,
      HOCUS_PORT: PORT,
      HOCUS_HOST: "127.0.0.1",
      HOCUS_THROTTLE: "0",
      HOCUS_ALLOWED_ORIGINS: "app://tinydocy",
    },
  });
  for (let i = 0; i < 100; i++) {
    const up = await fetch(`http://127.0.0.1:${PORT}/`).then(
      () => true,
      () => false,
    );
    if (up) return proc;
    await Bun.sleep(100);
  }
  throw new Error("hocus did not start");
}

async function stopHocus(proc: ReturnType<typeof Bun.spawn>) {
  proc.kill();
  await proc.exited;
}

async function launch(
  userData: string,
): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await _electron.launch({
    executablePath: packagedBinary(),
    env: {
      ...(process.env as Record<string, string>),
      TINYDOCY_USER_DATA: userData,
      SPIKE_ORIGIN: "app",
      SPIKE_HOCUS_URL: `ws://127.0.0.1:${PORT}`,
    },
  });
  const page = await app.firstWindow();
  await page
    .locator('.tiptap[contenteditable="true"]')
    .first()
    .waitFor({ timeout: 60_000 });
  return { app, page };
}

const synced = (page: Page) =>
  page.waitForFunction(
    () =>
      document
        .querySelector(".document-editor-content")
        ?.getAttribute("data-server-synced") === "true",
    undefined,
    { timeout: 45_000 },
  );

function log(line: string) {
  appendFileSync(
    join(EVIDENCE, "s4-log.txt"),
    `${new Date().toISOString()} ${line}\n`,
  );
}

test("the relaunch keeps the text, offline, then syncs", async () => {
  const started = performance.now();
  const userData = mkdtempSync(join(tmpdir(), "s4-user-"));
  const dbPath = join(mkdtempSync(join(tmpdir(), "s4-db-")), "s4.sqlite");
  let hocus = await startHocus(dbPath);
  try {
    // First launch: create a document in a new tab and type.
    let { app, page } = await launch(userData);
    await synced(page);
    const tabsBefore = await page.locator(".tab-bar-tab").count();
    await page.locator(".tab-bar-new").click();
    await expect(page.locator(".tab-bar-tab")).toHaveCount(tabsBefore + 1);
    await synced(page);
    const newTabId = await page
      .locator(".tab-bar-tab--active")
      .first()
      .evaluate((el) =>
        el.closest("[data-tab-id]")?.getAttribute("data-tab-id"),
      );
    const editor = page.locator('.tiptap[contenteditable="true"]').first();
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type(TEXT);
    await expect(editor).toContainText(TEXT);
    // Let the device copy and the server store settle before quitting.
    await page.waitForTimeout(1500);
    await app.close();

    // Relaunch with Hocus down: the text must come from the device copy.
    await stopHocus(hocus);
    ({ app, page } = await launch(userData));
    const activeTabId = await page
      .locator(".tab-bar-tab--active")
      .first()
      .evaluate((el) =>
        el.closest("[data-tab-id]")?.getAttribute("data-tab-id"),
      )
      .catch(() => null);
    const tabListed =
      (await page.locator(`[data-tab-id="${newTabId}"]`).count()) > 0;
    log(
      `offline relaunch: tabListed=${tabListed} activeRestored=${activeTabId === newTabId}`,
    );
    if (activeTabId !== newTabId && tabListed) {
      await page
        .locator(`[data-tab-id="${newTabId}"] .tab-bar-tab`)
        .first()
        .click();
    }
    const offlineEditor = page.locator(".tiptap").first();
    await expect(offlineEditor).toContainText(TEXT, { timeout: 20_000 });
    const syncedOffline = await page
      .locator(".document-editor-content")
      .first()
      .getAttribute("data-server-synced");
    log(`offline relaunch: text present, data-server-synced=${syncedOffline}`);
    await page.screenshot({ path: join(EVIDENCE, "offline-relaunch.png") });

    // Hocus back: the same document syncs.
    hocus = await startHocus(dbPath);
    await synced(page);
    await expect(page.locator(".tiptap").first()).toContainText(TEXT);
    log(
      `hocus back: synced; wall ${Math.round(performance.now() - started)} ms`,
    );
    await app.close();
  } finally {
    await stopHocus(hocus).catch(() => undefined);
  }
});
