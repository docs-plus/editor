# Spike S4: Playwright `_electron` drives the packaged app across a relaunch

- **Date:** 2026-11-16
- **Plan:** `docs/superpowers/plans/2026-11-16-phase-1-spikes.md`, Task S4
- **Spike branch (never merged):** `spike/s4-electron-e2e`, built from `spike/s1-shell` plus a merge of `spike/s3-packaging`. Code in `spikes/s4-electron-e2e/`, workflow `.github/workflows/spike-s4.yml`.
- **Verdict:** **pass** on macOS, Windows and Linux, at `--repeat-each=10` with no failures. The rerun after P1.1 lands is **pending** (§3.3).

## 1. Question

Can Playwright's `_electron` drive the **packaged** app in this sequence?
1. Launch it with its own user data.
2. Create a document in a new tab and type `S4 persists 日本語`.
3. Quit.
4. Stop Hocus.
5. Relaunch with the same user data.

At step 5 the text must come back from the origin's device copy (`lib/offline/`), before any server sync. It must then sync once Hocus is back. And the spec must be stable enough for P2.5's `electron` Playwright project.

## 2. Versions and setup

| Component | Version |
|---|---|
| Electron | 45.3.2 (Chromium 156, Node 24.22.2) |
| electron-builder | 26.18.0 (S3's pin), `--dir` |
| Playwright | 1.65.0 `_electron` |
| Origin | `app://tinydocy` (the S1 recommendation) |
| Runners | `macos-26` (macOS 26.7.2), `windows-latest` (Windows Server 2025), `ubuntu-24.04` under `xvfb-run -a` with the AppArmor sysctl |
| Local | Apple M5 Max, macOS 27.0.1 |

**Packaging.** The plan said to package with S3's config. When S4 started, S3's config packaged only its hello-world app, so S4 does what arch §3.1 step 3 describes:
1. `stage.ts` writes `stage/`: a `package.json` with only `name`, `version` and `main`, then S1's `main.cjs` and `preload.cjs`, then `renderer/` copied from `out/`.
2. `electron-builder.yml` (based on S3's) points `directories.app` at `stage/` and builds `--dir`.
3. Main serves `renderer/` from inside `app.asar` when `app.isPackaged`.

No root dependency reaches the asar. `bun electron-builder --dir` ran with the `node` stub on PATH on all three runners, with zero `node was called` lines. That is useful context for S3's first row, and S3 owns the verdict.

Hocus runs on loopback with a temp `DB_PATH`, `HOCUS_THROTTLE=0` and `HOCUS_ALLOWED_ORIGINS=app://tinydocy`. The spec starts and stops it.

## 3. Results

Workflow run [43916476476](https://github.com/docs-plus/editor/actions/runs/43916476476): all three green. A follow-up run, [43917610928](https://github.com/docs-plus/editor/actions/runs/43917610928), carries the S1 changes merged forward.

### 3.1 Rows

| Row | Result | OS |
|---|---|---|
| **The relaunch keeps the text.** The text comes back from the device copy with Hocus down (`data-server-synced="false"`), then `data-server-synced="true"` after Hocus restarts. | **Pass** | macOS, Windows, Linux (xvfb), and the local Mac |
| The new tab comes back offline from the `global-tabs` device copy, and its `activeTabId` is restored | **Pass**: `tabListed=true activeRestored=true` in every iteration, so the "open by id" fallback was never needed | all 3 |
| **The spec is stable**: `--repeat-each=10` | **Pass**: 10/10 on each runner and locally | all 3 |
| The same, after the `main` merge that brings P1.1 | **Pending**: P1.1 hasn't merged yet | none |

### 3.2 Wall time per run (ms, sorted, from launch to the synced relaunch)

| Runner | 10 runs | Total for 10 runs |
|---|---|---|
| `macos-26` | 6,286 · 7,228 · 7,751 · 7,807 · 7,938 · 8,382 · 8,436 · 9,207 · 11,346 · 15,976 | 99 s |
| `windows-latest` | 6,025 · 6,188 · 6,212 · 6,228 · 6,249 · 6,363 · 6,590 · 6,715 · 7,033 · 8,288 | 73 s |
| `ubuntu-24.04` | 4,850 · 4,882 · 4,889 · 4,902 · 4,903 · 4,908 · 4,917 · 4,967 · 5,081 · 24,445 (first, cold) | 74 s |
| Local Mac | 4,854 · 4,869 · 4,898 · 4,920 · 4,942 · 4,963 · 5,034 · 5,063 · 5,086 · 5,224 | 53.5 s |

Once Hocus is back, it syncs in 0.5–1 s.

### 3.3 Pending

- **The rerun after P1.1.** P1.1 changes the offline device copy (merge-on-save). Once it lands on `main`, S4 merges `main`, then reruns `spike-s4.yml` at `--repeat-each=10` on all three runners and records the times here.
- The rerun with S3's final config, once `spike/s3-packaging` packages the S1 export.

## 4. Evidence

- Playwright HTML reports, traces on failure, `s4-log.txt` (per iteration: `tabListed`, `activeRestored`, the offline `data-server-synced` value and the wall time) and an offline-relaunch screenshot: the `spike-s4-<os>` artifacts (`retention-days: 90`).
- The workflow logs record `wall seconds for 10 runs` and the `node was called` count from the builder log (0).

## 5. Decisions and feeds

- **The `electron` Playwright project (arch §11):** `_electron.launch` takes the packaged binary as `executablePath`, `TINYDOCY_USER_DATA` comes from a fresh temp directory, and Hocus is controlled from the spec. That shape works. Every launch needs its **own** user-data directory: a shared default `userData` carries the device copy from one test into the next.
- **P2.5's persistence spec** reuses this one and swaps the device copy for the P2.6 store. Its assertions stay the same.
- The staging layout (arch §3.1 step 3) packages as described, and `renderer/` is served from inside `app.asar` through Electron's `fs`.

## 6. Issues to file

None. The only open item is the rerun after P1.1 (§3.3), owned by the P1.1 merge.

## Appendix A: `spikes/s4-electron-e2e/persist.spec.ts` (reference for P2.5)

```ts
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
```

## Appendix B: staging and builder config

`spikes/s4-electron-e2e/stage.ts`:

```ts
/**
 * Stages dist/desktop-app the way arch §3.1 step 3 describes: a package.json
 * with only name, version and main, the CJS bundles, and renderer/ = out/.
 * Usage (repo root): bun spikes/s4-electron-e2e/stage.ts
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const STAGE = join(import.meta.dir, "stage");
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
writeFileSync(
  join(STAGE, "package.json"),
  `${JSON.stringify({ name: "tinydocy", version: "0.0.1", main: "main.cjs" }, null, 2)}\n`,
);
for (const file of ["main.cjs", "preload.cjs"]) {
  cpSync(join(ROOT, "spikes/s1-shell/dist", file), join(STAGE, file));
}
cpSync(join(ROOT, "out"), join(STAGE, "renderer"), { recursive: true });
console.log(`[s4] staged ${STAGE}`);
```

`spikes/s4-electron-e2e/electron-builder.yml`:

```yaml
# S4: package the S1 shell with the real export (arch §3.1 step 3 staging).
# Based on spikes/s3-packaging/electron-builder.yml, unpacked (--dir) only.
appId: plus.docs.tinydocy.spike
productName: TinyDocy
electronVersion: 45.3.2
directories:
  app: stage
  output: release
asar: true
mac:
  identity: null
linux:
  executableName: tinydocy
```
