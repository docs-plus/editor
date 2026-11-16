/**
 * Spike S1 automated rows. Run once per origin:
 *   SPIKE_ORIGIN=app   CI= bun playwright test -c spikes/s1-shell/playwright.config.ts
 *   SPIKE_ORIGIN=https CI= bun playwright test -c spikes/s1-shell/playwright.config.ts
 * Needs a loopback Hocus (S1_HOCUS_LOG points at its stdout) and `out/`.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  _electron,
  type ElectronApplication,
  expect,
  type Page,
  test,
} from "@playwright/test";

import { hostsInNetLog, nonLoopback } from "./netlog-hosts";

const DIR = __dirname;
const ORIGIN_KIND = process.env.SPIKE_ORIGIN === "https" ? "https" : "app";
const ORIGIN =
  ORIGIN_KIND === "https" ? "https://app.tinydocy.invalid" : "app://tinydocy";
const OS = process.platform;
const EVIDENCE = join(DIR, "evidence", `${OS}-${ORIGIN_KIND}`);
mkdirSync(EVIDENCE, { recursive: true });
const ELECTRON = createRequire(join(DIR, "package.json"))(
  "electron",
) as unknown as string;

const results: Record<string, unknown> = {
  origin: ORIGIN,
  os: OS,
  arch: process.arch,
};
function record(key: string, value: unknown): void {
  results[key] = value;
  const tag = process.env.S1_RESULTS_TAG
    ? `-${process.env.S1_RESULTS_TAG}`
    : "";
  writeFileSync(
    join(EVIDENCE, `results${tag}.json`),
    `${JSON.stringify(results, null, 2)}\n`,
  );
}

type S1 = Record<string, unknown> & {
  notFound: string[];
  requests: { status: number; path: string }[];
  ipc: {
    channel: string;
    accepted: boolean;
    frameUrl: string;
    top: boolean;
    reason?: string;
  }[];
  preloadFrames: string[];
  console: string[];
  contextMenus: { misspelled: string; suggestions: string[] }[];
  menuClicks: Record<string, number>;
  documentNavigations: string[];
  inPageNavigations: string[];
};

async function launch(name: string, env: Record<string, string> = {}) {
  const netlog = join(EVIDENCE, `${name}.netlog.json`);
  const app = await _electron.launch({
    executablePath: ELECTRON,
    args: [join(DIR, "dist/main.cjs")],
    env: {
      ...(process.env as Record<string, string>),
      SPIKE_ORIGIN: ORIGIN_KIND,
      SPIKE_NETLOG: netlog,
      SPIKE_HEAD_PROBE: "1",
      TINYDOCY_USER_DATA: mkdtempSync(join(tmpdir(), "s1-user-")),
      ...env,
    },
  });
  const page = await app.firstWindow();
  await page
    .locator('.ProseMirror[contenteditable="true"]')
    .first()
    .waitFor({ timeout: 60_000 });
  return { app, page, netlog };
}

const mainState = (app: ElectronApplication) =>
  app.evaluate(() => (globalThis as unknown as { __s1: S1 }).__s1);

async function violations(page: Page) {
  return page.evaluate(() =>
    (
      window as unknown as { tinydocySpike: { violations(): unknown[] } }
    ).tinydocySpike.violations(),
  ) as Promise<{ directive: string; blocked: string; sample: string }[]>;
}

async function focusEnd(page: Page) {
  await page.evaluate(() => {
    const editor = window.__tiptap_editor;
    if (!editor) return;
    editor
      .chain()
      .focus()
      .setTextSelection(editor.state.doc.content.size - 1)
      .run();
  });
  await page.waitForTimeout(100);
}

async function insertFromMenu(page: Page, item: RegExp) {
  await page
    .getByRole("toolbar")
    .getByRole("button", { name: "Insert", exact: true })
    .click();
  await page.getByRole("menuitem", { name: item }).first().click();
}

/** OS-level key press, so native menu accelerators see it (CDP keys do not). */
function osKey(key: string): string {
  if (OS === "darwin") {
    const r = spawnSync("osascript", [
      "-e",
      `tell application "System Events" to keystroke "${key}" using command down`,
    ]);
    return r.status === 0
      ? "ok"
      : `osascript failed: ${r.stderr.toString().trim()}`;
  }
  if (OS === "linux") {
    const r = spawnSync("xdotool", ["key", "--clearmodifiers", `ctrl+${key}`]);
    return r.status === 0
      ? "ok"
      : `xdotool failed: ${r.stderr.toString().trim()}`;
  }
  const r = spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    `(New-Object -ComObject WScript.Shell).SendKeys('^${key}')`,
  ]);
  return r.status === 0
    ? "ok"
    : `SendKeys failed: ${r.stderr.toString().trim()}`;
}

test("export, navigation, origin, CSP, assets, preload, sender", async () => {
  const { app, page, netlog } = await launch("core");
  try {
    await page
      .locator("[data-server-synced]")
      .first()
      .waitFor({ timeout: 30_000 })
      .catch(() => undefined);
    const synced = await page.locator("[data-server-synced]").count();
    record("serverSynced", synced > 0);

    // Preload vs boot script: who sees <html data-spike> first?
    const s0 = await mainState(app);
    record(
      "headProbe",
      s0.console.filter((l) => l.includes("[spike-head]")),
    );
    record(
      "preloadHtmlAttr",
      await page.evaluate(() =>
        (
          window as unknown as { tinydocySpike: { htmlAttr(): string } }
        ).tinydocySpike.htmlAttr(),
      ),
    );
    record(
      "htmlDatasetAfterLoad",
      await page.evaluate(() => document.documentElement.dataset.spike ?? null),
    );

    record(
      "styleElements",
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("style")).map((el) => ({
          attrs: Array.from(el.attributes)
            .map((a) => a.name)
            .join(" "),
          head: (el.textContent ?? "").slice(0, 60),
          length: (el.textContent ?? "").length,
        })),
      ),
    );

    // Sender check from the top frame.
    record(
      "topFramePing",
      await page.evaluate(() =>
        (
          window as unknown as { tinydocySpike: { ping(): Promise<unknown> } }
        ).tinydocySpike.ping(),
      ),
    );

    // CSP: type, paste formatted text, insert a table, open toolbar popovers.
    const phase: Record<string, number> = {
      load: (await violations(page)).length,
    };
    await focusEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("Hello from the desktop spike ");
    phase.type = (await violations(page)).length;
    // Electron 45's clipboard.write takes ClipboardItems; a synthetic paste
    // event runs the same ProseMirror paste path.
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData(
        "text/html",
        '<p><strong>bold</strong> <em>italic</em> <span style="color:#c00">red</span> <a href="https://example.com">link</a></p><table><tr><td>a</td><td style="background:#eee">b</td></tr></table>',
      );
      dt.setData("text/plain", "bold italic red link");
      document.querySelector(".ProseMirror")?.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await page.waitForTimeout(300);
    phase.paste = (await violations(page)).length;
    await focusEnd(page);
    try {
      await insertFromMenu(page, /^Table/);
      await page.waitForTimeout(300);
      if (!(await page.locator(".tiptap table").count())) {
        await page.keyboard.press("Enter");
      }
    } catch {
      /* fall through to the command */
    }
    if (!(await page.locator(".tiptap table").count())) {
      await page.evaluate(() =>
        window.__tiptap_editor
          ?.chain()
          .focus()
          .insertTable({ rows: 3, cols: 3 })
          .run(),
      );
    }
    await expect(page.locator(".tiptap table").first()).toBeVisible();
    phase.table = (await violations(page)).length;
    const popoverButtons = page.locator(
      '[role="toolbar"] button[aria-haspopup]',
    );
    const n = Math.min(await popoverButtons.count(), 14);
    let opened = 0;
    for (let i = 0; i < n; i++) {
      const button = popoverButtons.nth(i);
      if (!(await button.isVisible()) || !(await button.isEnabled())) continue;
      await focusEnd(page);
      await button.click().catch(() => undefined);
      await page.waitForTimeout(250);
      opened++;
      await page.keyboard.press("Escape");
    }
    phase.popovers = (await violations(page)).length;
    record("popoversOpened", opened);
    await page.screenshot({ path: join(EVIDENCE, "editor.png") });
    const v = await violations(page);
    record("cspPhases", phase);
    record("cspViolations", v);

    // Client navigation: editor -> /about -> editor without a new document.
    await page.evaluate(() => {
      (window as unknown as { __s1Marker: number }).__s1Marker = 42;
    });
    const navsBefore = (await mainState(app)).documentNavigations.length;
    const link = page.locator('a[href="/about"]').first();
    if (await link.count()) {
      await link.click();
    } else {
      await page.evaluate(() =>
        (
          window as unknown as { next: { router: { push(p: string): void } } }
        ).next.router.push("/about"),
      );
    }
    await page.waitForURL(/\/about$/, { timeout: 15_000 });
    await page.waitForTimeout(500);
    const markerOnAbout = await page.evaluate(
      () => (window as unknown as { __s1Marker?: number }).__s1Marker ?? null,
    );
    await page.evaluate(() =>
      (
        window as unknown as { next: { router: { push(p: string): void } } }
      ).next.router.push("/"),
    );
    await page.waitForURL(/tinydocy[^/]*\/$/, { timeout: 15_000 });
    await page
      .locator('.ProseMirror[contenteditable="true"]')
      .first()
      .waitFor({ timeout: 30_000 });
    const markerBack = await page.evaluate(
      () => (window as unknown as { __s1Marker?: number }).__s1Marker ?? null,
    );
    const s1 = await mainState(app);
    record("notFoundBeforeProbes", [...s1.notFound]);
    record("clientNav", {
      viaLink: (await link.count()) > 0,
      markerOnAbout,
      markerBack,
      documentNavigationsDuringNav: s1.documentNavigations.length - navsBefore,
      inPageNavigations: s1.inPageNavigations,
    });

    // /_asset/<hex>: served through img-src 'self', traversal refused.
    const asset = await page.evaluate(async () => {
      const hex = "a".repeat(64);
      const ok = await fetch(`/_asset/${hex}`);
      const img = new Image();
      const loaded = await new Promise<number>((done) => {
        img.onload = () => done(img.naturalWidth);
        img.onerror = () => done(-1);
        img.src = `/_asset/${hex}`;
      });
      const probes: Record<string, number> = {};
      for (const p of [
        "/_asset/../main.cjs",
        "/_asset/%2e%2e/main.cjs",
        "/_asset/..%2fmain.cjs",
        "/_asset/..%2f..%2fspikes%2fs1-shell%2fmain.ts",
        "/..%2fspikes%2fs1-shell%2fmain.ts",
        "/%2e%2e/%2e%2e/package.json",
        `/_asset/${"b".repeat(64)}`,
        "/_asset/AAAA",
      ]) {
        probes[p] = (await fetch(p)).status;
      }
      return {
        status: ok.status,
        type: ok.headers.get("content-type"),
        imgWidth: loaded,
        probes,
      };
    });
    const blobBefore = (await violations(page)).length;
    const blobImg = await page.evaluate(async () => {
      const blob = new Blob([new Uint8Array([137, 80, 78, 71])], {
        type: "image/png",
      });
      const img = new Image();
      return new Promise<string>((done) => {
        img.onload = () => done("loaded");
        img.onerror = () => done("blocked-or-error");
        img.src = URL.createObjectURL(blob);
      });
    });
    record("asset", {
      ...asset,
      blobImg,
      blobViolations: (await violations(page)).length - blobBefore,
    });

    // Startup marks and the request log.
    const s2 = await mainState(app);
    record("marks", { main: s2.marks, renderer: s2.rendererMarks });
    record("inlineScripts", s2.inlineScripts);
    record("inlineStyles", s2.inlineStyles);
    record("notFound", s2.notFound);
    record(
      "fontRequests",
      s2.requests
        .filter((r) => /\.woff2?$/.test(r.path))
        .map((r) => `${r.status} ${r.path}`),
    );
    record("preloadFrames", s2.preloadFrames);
    record("ipc", s2.ipc);
  } finally {
    await app.close();
  }
  const hosts = hostsInNetLog(netlog);
  record("coreNetlogNonLoopbackHosts", nonLoopback(hosts));
  if (process.env.S1_HOCUS_LOG && existsSync(process.env.S1_HOCUS_LOG)) {
    const lines = readFileSync(process.env.S1_HOCUS_LOG, "utf8")
      .split("\n")
      .filter((l) => l.includes("[spike-s1] upgrade origin="));
    record("hocusUpgradeOrigins", [
      ...new Set(lines.map((l) => l.split("origin=")[1])),
    ]);
    record(
      "hocusRejections",
      readFileSync(process.env.S1_HOCUS_LOG, "utf8")
        .split("\n")
        .filter((l) => l.includes("ws_upgrade_rejected"))
        .slice(0, 5),
    );
  }
  // /privacy is web-only; /about links to it (recorded as a finding).
  expect(
    (results.notFoundBeforeProbes as string[]).filter((p) => p !== "/privacy"),
  ).toEqual([]);
  const appViolations = (
    results.cspViolations as { directive: string; blocked: string }[]
  ).filter((v) => !(v.directive === "img-src" && /^https:/.test(v.blocked)));
  record("cspAppViolations", appViolations.length);
  expect(appViolations).toEqual([]);
});

test("sender check refuses a subframe", async () => {
  const { app } = await (async () => {
    const a = await _electron.launch({
      executablePath: ELECTRON,
      args: [join(DIR, "dist/main.cjs")],
      env: {
        ...(process.env as Record<string, string>),
        SPIKE_ORIGIN: ORIGIN_KIND,
        SPIKE_FRAME_TEST: "1",
        TINYDOCY_USER_DATA: mkdtempSync(join(tmpdir(), "s1-user-")),
      },
    });
    return { app: a };
  })();
  try {
    await expect
      .poll(
        async () => (await mainState(app)).ipc.filter((e) => !e.top).length,
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0);
    const s = await mainState(app);
    record(
      "subframeIpc",
      s.ipc.filter((e) => !e.top),
    );
    expect(s.ipc.filter((e) => !e.top).every((e) => !e.accepted)).toBe(true);
  } finally {
    await app.close();
  }
});

test("spellcheck: no network, word flagged", async () => {
  const { app, page, netlog } = await launch(
    "spellcheck",
    process.env.S1_DICT_URL ? { SPIKE_DICT_URL: process.env.S1_DICT_URL } : {},
  );
  try {
    await focusEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("This sentance has a mispeled wrod ");
    await page.waitForTimeout(2500);
    const box = await page.evaluate(() => {
      const walker = document.createTreeWalker(
        document.querySelector(".ProseMirror") as Node,
        NodeFilter.SHOW_TEXT,
      );
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const i = n.textContent?.indexOf("mispeled") ?? -1;
        if (i >= 0) {
          const r = document.createRange();
          r.setStart(n, i + 2);
          r.setEnd(n, i + 3);
          const b = r.getBoundingClientRect();
          return { x: b.x, y: b.y + b.height / 2 };
        }
      }
      return null;
    });
    if (box) await page.mouse.click(box.x, box.y, { button: "right" });
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape");
    const s = await mainState(app);
    record("spellcheckContextMenu", s.contextMenus);
    record(
      "spellcheckEvents",
      (s as unknown as { spellcheck: string[] }).spellcheck,
    );
    const para = page
      .locator(".ProseMirror p", { hasText: "mispeled" })
      .first();
    await para.screenshot({ path: join(EVIDENCE, "spellcheck.png") });
  } finally {
    await app.close();
  }
  const hosts = nonLoopback(hostsInNetLog(netlog));
  record("spellcheckNetlogNonLoopbackHosts", hosts);
});

test("native menu: no double fire, intents run the Yjs undo", async () => {
  const { app, page } = await launch("menu");
  try {
    await app.evaluate(({ BrowserWindow, app: a }) => {
      a.focus({ steal: true });
      BrowserWindow.getAllWindows()[0]?.focus();
    });
    await focusEnd(page);
    await page.keyboard.press("Enter");
    await page.keyboard.type("menu probe");
    await page.waitForTimeout(700);
    await page.evaluate(() => {
      const editor = window.__tiptap_editor;
      if (!editor) return;
      const end = editor.state.selection.from;
      editor
        .chain()
        .focus()
        .setTextSelection({ from: end - 5, to: end })
        .run();
    });
    const isBold = () =>
      page.evaluate(() => window.__tiptap_editor?.isActive("bold") ?? null);
    const before = { bold: await isBold() };
    const keyB = osKey("b");
    await page.waitForTimeout(600);
    const afterB = {
      bold: await isBold(),
      clicks: { ...(await mainState(app)).menuClicks },
    };
    const keyZ = osKey("z");
    await page.waitForTimeout(600);
    const afterZ = {
      bold: await isBold(),
      text: await page.evaluate(
        () =>
          window.__tiptap_editor?.state.selection.$from.parent.textContent ??
          null,
      ),
      clicks: { ...(await mainState(app)).menuClicks },
    };
    // Menu intents (the native menu item's click) reach the Yjs undo.
    await page.evaluate(() =>
      window.__tiptap_editor?.chain().focus().toggleBold().run(),
    );
    await page.waitForTimeout(700);
    const boldViaCommand = await isBold();
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById("undo")?.click(),
    );
    await page.waitForTimeout(500);
    const afterIntentUndo = await isBold();
    await app.evaluate(({ Menu }) =>
      Menu.getApplicationMenu()?.getMenuItemById("redo")?.click(),
    );
    await page.waitForTimeout(500);
    const afterIntentRedo = await isBold();
    const enablement = await app.evaluate(({ Menu }) => ({
      undo: Menu.getApplicationMenu()?.getMenuItemById("undo")?.enabled,
      redo: Menu.getApplicationMenu()?.getMenuItemById("redo")?.enabled,
    }));
    const rendererIntents = await page.evaluate(
      () => window.__spikeIntentCount ?? null,
    );
    record("menu", {
      osKeys: { b: keyB, z: keyZ },
      before,
      afterB,
      afterZ,
      boldViaCommand,
      afterIntentUndo,
      afterIntentRedo,
      enablement,
      rendererIntents,
      menuClicks: (await mainState(app)).menuClicks,
    });
  } finally {
    await app.close();
  }
});

test("embeds: YouTube plays, X is a link card", async () => {
  const { app, page, netlog } = await launch("embeds");
  try {
    await focusEnd(page);
    await insertFromMenu(page, /^Embed/);
    await page
      .getByLabel("Media URL")
      .fill("https://www.youtube.com/watch?v=jNQXAC9IVRw");
    await page.getByRole("button", { name: "Embed", exact: true }).click();
    const iframe = page.locator('.tiptap iframe[src*="youtube"]').first();
    await iframe.waitFor({ timeout: 20_000 });
    record("youtubeIframe", {
      src: await iframe.getAttribute("src"),
      referrerpolicy: await iframe.getAttribute("referrerpolicy"),
      allow: await iframe.getAttribute("allow"),
    });
    await iframe.scrollIntoViewIfNeeded();
    await page.waitForTimeout(6000);
    const frame = page.frames().find((f) => /youtube/.test(f.url()));
    let player: Record<string, unknown> = { frameFound: !!frame };
    if (frame) {
      player = await frame
        .evaluate(() => {
          const text = document.body?.innerText ?? "";
          return {
            frameFound: true,
            error153: /153|configuration error/i.test(text),
            errorText:
              (
                document.querySelector(
                  ".ytp-error-content-wrap, .ytp-error",
                ) as HTMLElement | null
              )?.innerText ?? null,
            botCheck: /sign in to confirm|not a bot/i.test(text),
            hasVideo: !!document.querySelector("video"),
            ancestorOrigins: Array.from(location.ancestorOrigins ?? []),
            referrer: document.referrer,
          };
        })
        .catch((e) => ({ frameFound: true, evalError: String(e) }));
      player.readyState = await frame
        .evaluate(() => document.readyState)
        .catch(() => null);
      player.shellState = await page
        .locator(".hm-media-host:has(iframe)")
        .first()
        .getAttribute("data-hm-loading")
        .catch(() => null);
      // A real click on the iframe centre is the user gesture autoplay needs.
      const box = await iframe.boundingBox();
      if (box)
        await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForTimeout(8000);
      player.afterClick = await frame
        .evaluate(() => {
          const video = document.querySelector("video");
          return {
            currentTime: video?.currentTime ?? null,
            paused: video?.paused ?? null,
            error:
              (document.querySelector(".ytp-error") as HTMLElement | null)
                ?.innerText ?? null,
          };
        })
        .catch((e) => ({ evalError: String(e) }));
      player.shellStateAfter = await page
        .locator(".hm-media-host:has(iframe)")
        .first()
        .getAttribute("data-hm-loading")
        .catch(() => null);
    }
    record("youtubePlayer", player);
    await iframe
      .screenshot({ path: join(EVIDENCE, "youtube.png") })
      .catch(() => undefined);
    await page.screenshot({ path: join(EVIDENCE, "youtube-page.png") });

    const beforeX = (await violations(page)).length;
    // Embed dialog with an X URL.
    await focusEnd(page);
    await insertFromMenu(page, /^Embed/);
    await page.getByLabel("Media URL").fill("https://x.com/jack/status/20");
    await page
      .getByRole("button", { name: "Embed", exact: true })
      .click()
      .catch(() => undefined);
    await page.waitForTimeout(1500);
    const dialogText = await page
      .locator(
        '[role="dialog"], [data-radix-popper-content-wrapper], .hm-popover',
      )
      .first()
      .innerText()
      .catch(() => null);
    await page.keyboard.press("Escape");
    // Pasting the URL as plain text.
    await focusEnd(page);
    await page.keyboard.press("Enter");
    await page.evaluate(() => {
      const dt = new DataTransfer();
      dt.setData("text/plain", "https://x.com/jack/status/20");
      document.querySelector(".ProseMirror")?.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    await page.waitForTimeout(4000);
    const xNode = await page.evaluate(() => {
      const embed = document.querySelector(
        '.tiptap [data-type="x"], .tiptap .hm-media-host:has([data-x-url]), .tiptap [class*="x-embed"]',
      );
      const link = document.querySelector('.tiptap a[href^="https://x.com/"]');
      return {
        embed: embed ? (embed as HTMLElement).outerHTML.slice(0, 200) : null,
        link: link ? (link as HTMLElement).outerHTML.slice(0, 200) : null,
        topLevelTypes: (() => {
          const types: string[] = [];
          window.__tiptap_editor?.state.doc.forEach((n) => {
            types.push(n.type.name);
          });
          return types.slice(-4);
        })(),
        lastBlocks: (() => {
          const out: unknown[] = [];
          window.__tiptap_editor?.state.doc.forEach((n) => {
            out.push(n.toJSON());
          });
          return JSON.stringify(out.slice(-3)).slice(0, 400);
        })(),
      };
    });
    const vX = (await violations(page)).slice(beforeX);
    record("xEmbed", { dialogText, node: xNode, violations: vX });
    await page.screenshot({ path: join(EVIDENCE, "x-embed.png") });
    const s = await mainState(app);
    record(
      "youtubeReferers",
      (s as unknown as { youtubeReferers: unknown[] }).youtubeReferers.slice(
        0,
        6,
      ),
    );
    record("embedPreloadFrames", s.preloadFrames);
  } finally {
    await app.close();
  }
  const hosts = hostsInNetLog(netlog);
  record("embedsNetlogHosts", nonLoopback(hosts));
  record(
    "widgetsJsRequested",
    readFileSync(netlog, "utf8").includes("platform.twitter.com/widgets.js"),
  );
});
