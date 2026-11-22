/**
 * P2.5 exit criteria on the packaged app (plan §8.4 P2.5; architecture
 * §11 `electron` project):
 * - D-A12: the storage worker opens `node:sqlite` in a worker thread with
 *   WAL, and the `app://tinydocy` handler serves the export with the CSP;
 * - the typed bridge round-trips a document through the real worker;
 * - opening a document already open in another window focuses that window;
 * - navigation, `window.open` and bad `argv` are refused;
 * - no reload, DevTools or zoom; sandboxed windows;
 * - #106: quitting with a vetoing `beforeunload` and unsynced edits exits
 *   within the budget (3 s flush + 2 s shutdown).
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, type Page, test } from "@playwright/test";

import {
  diagnostics,
  firstPage,
  type Launched,
  launch,
  ROOT,
  secondInstance,
  startHocus,
  waitForEvent,
} from "./helpers";

type Bridge = {
  invoke(
    channel: string,
    args: unknown,
  ): Promise<{
    ok: boolean;
    value?: unknown;
    error?: { code: string };
  }>;
  on(channel: string, listener: (payload: unknown) => unknown): () => void;
};
declare global {
  interface Window {
    tinydocy: Bridge;
  }
}

const EDITOR = '.tiptap[contenteditable="true"]';
const RESULTS = join(ROOT, "test-results-electron");
let hocus: Awaited<ReturnType<typeof startHocus>> | null = null;

test.beforeAll(async () => {
  hocus = await startHocus(
    join(mkdtempSync(join(tmpdir(), "tinydocy-hocus-")), "db.sqlite"),
  );
});
test.afterAll(async () => {
  hocus?.kill();
  await hocus?.exited;
});

let current: Launched | null = null;
test.afterEach(async () => {
  if (!current) return;
  const proc = current.app.process();
  if (proc.exitCode === null) {
    await current.app.close().catch(() => undefined);
  }
  current = null;
});

const windowIds = (launched: Launched) =>
  launched.app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => w.id),
  );

test("D-A12: the worker opens node:sqlite with WAL and the protocol serves the export", async () => {
  current = await launch();
  const { app, userData } = current;
  const page = await firstPage(app);

  const started = await waitForEvent(app, "storage_started");
  expect(started.readOnly).toBe("no");

  const served = await page.evaluate(async () => {
    const index = await fetch("/");
    const traversal = await Promise.all(
      [
        "/../main.cjs",
        "/%2e%2e/main.cjs",
        "/..%2fmain.cjs",
        "/main.cjs",
        "/package.json",
      ].map(async (path) => (await fetch(path)).status),
    );
    return {
      status: index.status,
      type: index.headers.get("content-type"),
      csp: index.headers.get("content-security-policy") ?? "",
      nosniff: index.headers.get("x-content-type-options"),
      traversal,
    };
  });
  expect(served.status).toBe(200);
  expect(served.type).toContain("text/html");
  expect(served.nosniff).toBe("nosniff");
  expect(served.csp).toContain("script-src 'self' 'sha256-");
  expect(served.csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
  expect(served.csp).toContain("img-src 'self';");
  expect(served.traversal).toEqual([404, 404, 404, 404, 404]);

  // A write makes the WAL file appear next to the library.
  const appended = await page.evaluate(async () => {
    const created = await window.tinydocy.invoke("index.create", {
      title: "WAL",
    });
    const docId = (created.value as { id: string }).id;
    await window.tinydocy.invoke("doc.open", { docId });
    return window.tinydocy.invoke("doc.append", {
      docId,
      record: { origin: "local", update: new Uint8Array([0, 0]) },
    });
  });
  expect(appended.ok).toBe(true);
  expect(existsSync(join(userData, "library", "library.sqlite-wal"))).toBe(
    true,
  );
});

test("windows are sandboxed, shown on ready-to-show, with no reload, DevTools or zoom", async () => {
  current = await launch();
  const { app } = current;
  const page = await firstPage(app);
  await waitForEvent(app, "window_ready_to_show");

  const roles = await app.evaluate(({ Menu }) => {
    const out: string[] = [];
    const walk = (menu: Electron.Menu | null) => {
      for (const item of menu?.items ?? []) {
        if (item.role) out.push(String(item.role).toLowerCase());
        walk(item.submenu ?? null);
      }
    };
    walk(Menu.getApplicationMenu());
    return out;
  });
  for (const banned of [
    "reload",
    "forcereload",
    "toggledevtools",
    "zoomin",
    "zoomout",
    "resetzoom",
  ])
    expect(roles).not.toContain(banned);
  expect(roles).toContain("copy");
  expect(roles).toContain("paste");

  await page.keyboard.press("Control+=");
  await page.keyboard.press("Meta+=");
  const zoom = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.getZoomLevel(),
  );
  expect(zoom).toBe(0);
  // The preload exposes the bridge and nothing that reaches ipcRenderer.
  const surface = await page.evaluate(() => ({
    keys: Object.keys(window.tinydocy).sort(),
    require: typeof (window as unknown as { require?: unknown }).require,
    process: typeof (window as unknown as { process?: unknown }).process,
  }));
  expect(surface).toEqual({
    keys: ["build", "invoke", "on"],
    require: "undefined",
    process: "undefined",
  });
});

test("the typed bridge round-trips a document and enforces the contract", async () => {
  current = await launch();
  const page = await firstPage(current.app);
  const result = await page.evaluate(async () => {
    const t = window.tinydocy;
    const created = await t.invoke("index.create", { title: "Bridge" });
    const docId = (created.value as { id: string }).id;
    const opened = await t.invoke("doc.open", { docId });
    const appended = await t.invoke("doc.append", {
      docId,
      record: {
        origin: "local",
        update: new Uint8Array([0, 0]),
        title: "Bridge",
      },
    });
    const flushed = await t.invoke("doc.flush", {});
    const closed = await t.invoke("doc.close", { docId });
    const reopened = await t.invoke("doc.open", { docId });
    const other = await t.invoke("doc.append", {
      docId: crypto.randomUUID(),
      record: { origin: "local", update: new Uint8Array([0, 0]) },
    });
    const badArgs = await t.invoke("doc.open", { docId: "playground" });
    const extraKey = await t.invoke("doc.open", { docId, owner: "w99" });
    const badOrigin = await t.invoke("doc.append", {
      docId,
      record: { origin: "server", update: new Uint8Array([0, 0]) },
    });
    const unknown = await t.invoke("fs.readFile" as never, {});
    return {
      created: created.ok,
      opened: opened.ok,
      appended,
      flushed: flushed.ok,
      closed: closed.ok,
      reopenedUpdates: (reopened.value as { updates: unknown[] }).updates
        .length,
      other: other.error?.code,
      badArgs: badArgs.error?.code,
      extraKey: extraKey.error?.code,
      badOrigin: badOrigin.error?.code,
      unknown: unknown.error?.code,
    };
  });
  expect(result).toMatchObject({
    created: true,
    opened: true,
    appended: { ok: true },
    flushed: true,
    closed: true,
    reopenedUpdates: 1,
    other: "forbidden",
    badArgs: "invalid_argument",
    extraKey: "invalid_argument",
    badOrigin: "invalid_argument",
    unknown: "invalid_argument",
  });
});

test("opening a document already open in another window focuses that window", async () => {
  current = await launch();
  const { app, userData } = current;
  await firstPage(app);
  const docA = randomUUID();
  const docB = randomUUID();

  expect(await secondInstance(userData, [`tinydocy://local/${docA}`])).toBe(0);
  const createdA = await waitForEvent(
    app,
    "window_created",
    (e) => e.forDoc === true,
  );
  expect(await secondInstance(userData, [`tinydocy://local/${docB}`])).toBe(0);
  await expect.poll(() => windowIds(current as Launched)).toHaveLength(3);

  // The same link again: no new window, window A comes forward.
  expect(await secondInstance(userData, [`tinydocy://local/${docA}`])).toBe(0);
  const focused = await waitForEvent(app, "open_focused_existing");
  expect(focused.window).toBe(createdA.window);
  expect(await windowIds(current)).toHaveLength(3);

  // Through the bridge: window B asks for A's document.
  const pages = app.windows();
  let pageB: Page | null = null;
  for (const page of pages) {
    const hello = await page.evaluate(() =>
      window.tinydocy.invoke("app.hello", {}),
    );
    if ((hello.value as { docId: string | null }).docId === docB) pageB = page;
  }
  expect(pageB).not.toBeNull();
  const before = (await diagnostics(app)).filter(
    (e) => e.event === "window_focused",
  ).length;
  const answer = await (pageB as Page).evaluate(
    (docId) => window.tinydocy.invoke("doc.open", { docId }),
    docA,
  );
  expect(answer.error?.code).toBe("already_open");
  const focusEvents = (await diagnostics(app)).filter(
    (e) => e.event === "window_focused",
  );
  expect(focusEvents.length).toBe(before + 1);
  expect(focusEvents.at(-1)?.window).toBe(createdA.window);
});

test("navigation, window.open and bad argv are refused", async () => {
  const dir = mkdtempSync(join(tmpdir(), "tinydocy-argv-"));
  const goodFile = join(dir, "notes.md");
  writeFileSync(goodFile, "# Notes\n");
  current = await launch({
    args: ["tinydocy://evil/x", join(dir, "missing.md")],
  });
  const { app, userData } = current;
  const page = await firstPage(app);

  const firstRefusal = await waitForEvent(app, "argv_refused");
  expect(firstRefusal.count).toBe(2);
  expect(await windowIds(current)).toHaveLength(1);

  const bad = [
    `tinydocy://local/not-a-uuid`,
    `tinydocy://local/${randomUUID()}?next=https://example.com`,
    join(dir, "missing.md"),
    join(dir, "notes.txt"),
    "javascript:alert(1)",
    "https://example.com/",
    "file:///etc/passwd",
  ];
  expect(await secondInstance(userData, bad)).toBe(0);
  await expect
    .poll(async () =>
      (await diagnostics(app))
        .filter((e) => e.event === "argv_refused")
        .map((e) => e.count),
    )
    .toEqual([2, bad.length]);
  expect(await windowIds(current)).toHaveLength(1);

  expect(await secondInstance(userData, [goodFile])).toBe(0);
  const accepted = await waitForEvent(app, "open_file_accepted");
  expect(accepted.type).toBe("md");

  const startUrl = page.url();
  await page.evaluate(() => {
    window.location.href = "https://example.com/";
  });
  await waitForEvent(app, "navigation_refused");
  await page.evaluate(() => {
    window.location.href = "file:///etc/passwd";
  });
  await expect
    .poll(
      async () =>
        (await diagnostics(app)).filter((e) => e.event === "navigation_refused")
          .length,
    )
    .toBe(2);
  expect(page.url()).toBe(startUrl);

  const opened = await page.evaluate(
    () => window.open("https://example.com/") === null,
  );
  expect(opened).toBe(true);
  await waitForEvent(app, "window_open_refused");
  const external = (await diagnostics(app)).filter(
    (e) => e.event === "external_open",
  );
  // The two https URLs went to the (logged) system browser; file: did not.
  expect(external).toHaveLength(2);
  expect(await windowIds(current)).toHaveLength(1);
});

test("#106: quit with unsynced edits and a vetoing beforeunload exits within budget", async () => {
  current = await launch();
  const { app, stdout } = current;
  const page = await firstPage(app);
  await page.locator(EDITOR).first().waitFor({ timeout: 60_000 });

  // A page that keeps unsaved work answers the flush after its batch is acked.
  await page.evaluate(() => {
    window.tinydocy.on(
      "app.flushRequested",
      () => new Promise<void>((resolve) => setTimeout(resolve, 200)),
    );
    window.addEventListener("beforeunload", (event) => {
      event.preventDefault();
      event.returnValue = "";
    });
  });
  // Stop the server so the edits stay unacked: the web guard is armed too.
  hocus?.kill();
  await hocus?.exited;
  await page.locator(EDITOR).first().click();
  await page.keyboard.type("unsynced edit before quit");

  const proc = app.process();
  const exited = new Promise<number | null>((resolve) =>
    proc.once("exit", (code) => resolve(code)),
  );
  const started = Date.now();
  await app.evaluate(({ app: electronApp }) => {
    setTimeout(() => electronApp.quit(), 0);
  });
  const code = await Promise.race([
    exited,
    new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 15_000)),
  ]);
  const wallMs = Date.now() - started;
  const marks = stdout
    .filter((line) => line.startsWith("[tinydocy] "))
    .map(
      (line) =>
        JSON.parse(line.slice("[tinydocy] ".length)) as Record<string, unknown>,
    )
    .filter((e) =>
      [
        "quit_start",
        "flush_done",
        "flush_timeout",
        "storage_closed",
        "exit",
        "watchdog_exit",
      ].includes(String(e.event)),
    );

  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(
    join(RESULTS, `quit-timings-${process.platform}.json`),
    `${JSON.stringify({ platform: process.platform, wallMs, code, marks }, null, 2)}\n`,
  );
  console.log(
    `[quit] ${process.platform} wall ${wallMs} ms`,
    JSON.stringify(marks),
  );

  expect(code).toBe(0);
  expect(wallMs).toBeLessThan(6000);
  expect(marks.map((m) => m.event)).toEqual([
    "quit_start",
    "flush_done",
    "storage_closed",
    "exit",
  ]);
  expect(marks.find((m) => m.event === "storage_closed")?.outcome).toBe(
    "clean",
  );

  // Restart the server for any test that runs after this one.
  hocus = await startHocus(
    join(mkdtempSync(join(tmpdir(), "tinydocy-hocus-")), "db.sqlite"),
  );
});

test("closing the last window flushes it, then quits (Windows and Linux)", async () => {
  test.skip(
    process.platform === "darwin",
    "macOS keeps running with no window",
  );
  current = await launch();
  const { app } = current;
  await firstPage(app);
  const proc = app.process();
  const exited = new Promise<number | null>((resolve) =>
    proc.once("exit", (code) => resolve(code)),
  );
  await app.evaluate(({ BrowserWindow }) => {
    setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 0);
  });
  const code = await Promise.race([
    exited,
    new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 15_000)),
  ]);
  expect(code).toBe(0);
});
