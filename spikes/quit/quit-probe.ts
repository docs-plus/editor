// Spike #106 probe, loaded before S5's instrumentation and S1's shell. It
// replays S5's trial without Playwright: wait for the first server sync, load
// an N-heading document, apply the CDP CPU throttle, type K keys through real
// input events (webContents.sendInputEvent), then ask the app to quit the way
// a user does (app.quit() is what Cmd+Q and the Quit menu item call; or
// close the window) and log every lifecycle event on the way out.
//
// Lines go to stdout as `[quit] {json}`; `ms` is main's clock since the quit
// request. The runner (run.ts) times the process exit on its own clock.
import { performance } from "node:perf_hooks";

import { app, BrowserWindow, type WebContents } from "electron";

import { generateLargeDocument } from "../../tests/helpers/document-generators";

const env = process.env;
const HEADINGS = Number(env.QUIT_HEADINGS ?? 500);
const KEYS = Number(env.QUIT_KEYS ?? 220);
/** Playwright's press(key, { delay: 10 }) waits between down and up; this
 * waits after each key, same cadence. */
const KEY_DELAY_MS = Number(env.QUIT_KEY_DELAY_MS ?? 10);
const THROTTLE = Number(env.QUIT_THROTTLE ?? 4);
const VIA = env.QUIT_VIA === "window-close" ? "window-close" : "app-quit";
/** Wait after the last key before quitting (0: quit at once, like S5). */
const SETTLE_MS = Number(env.QUIT_SETTLE_MS ?? 0);
/** Leave the CDP throttle on through quit (S5 did), or lift it first. */
const KEEP_THROTTLE = env.QUIT_KEEP_THROTTLE !== "0";

let requestedAt = 0;
const since = () =>
  requestedAt ? Math.round((performance.now() - requestedAt) * 10) / 10 : null;
export const quitLog = (event: string, extra: Record<string, unknown> = {}) => {
  console.log(`[quit] ${JSON.stringify({ event, ms: since(), ...extra })}`);
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const waitFor = async (
  wc: WebContents,
  expression: string,
  what: string,
  timeoutMs = 60_000,
) => {
  const giveUp = Date.now() + timeoutMs;
  while (Date.now() < giveUp) {
    if (await wc.executeJavaScript(expression).catch(() => false)) return;
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}`);
};

/** What Playwright's keyboard.press does: CDP key events, each acked by the
 * renderer before the next, so no input backlog builds up. */
const press = async (wc: WebContents, key: string) => {
  const base = {
    key,
    code: `Key${key.toUpperCase()}`,
    windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
  };
  await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
    type: "keyDown",
    text: key,
    ...base,
  });
  await wc.debugger.sendCommand("Input.dispatchKeyEvent", {
    type: "keyUp",
    ...base,
  });
};

for (const event of ["before-quit", "will-quit", "window-all-closed"] as const)
  app.on(event as "before-quit", () => quitLog(event));
app.on("quit", (_e, code) => quitLog("quit", { code }));
process.on("exit", (code) => quitLog("process-exit", { code }));

app.on("web-contents-created", (_e, wc) => {
  wc.on("will-prevent-unload", () => quitLog("will-prevent-unload"));
  wc.on("render-process-gone", (_e2, d) =>
    quitLog("render-process-gone", { reason: d.reason }),
  );
  wc.on("destroyed", () => quitLog("webcontents-destroyed"));
});
app.on("browser-window-created", (_e, win) => {
  win.on("close", () => quitLog("window-close"));
  win.on("closed", () => quitLog("window-closed"));
});

const drive = async () => {
  const win = await new Promise<BrowserWindow>((resolve) => {
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing) resolve(existing);
    else app.once("browser-window-created", (_e, w) => resolve(w));
  });
  const wc = win.webContents;
  await waitFor(
    wc,
    `!!document.querySelector('[data-server-synced="true"]') && !!window.__tiptap_editor`,
    "first server sync",
  );
  quitLog("synced");
  if (HEADINGS > 0) {
    const doc = generateLargeDocument(HEADINGS, { shape: "flat" });
    const json = JSON.stringify(doc);
    await wc.executeJavaScript(
      `window.__tiptap_editor.commands.setContent(${json}); true`,
    );
    quitLog("content-set", { headings: HEADINGS, bytes: json.length });
    await sleep(500);
  }
  wc.debugger.attach("1.3");
  if (THROTTLE > 1) {
    await wc.debugger.sendCommand("Emulation.setCPUThrottlingRate", {
      rate: THROTTLE,
    });
  }
  // S5 clicks `.tiptap p`: put the caret at the start of the first paragraph.
  await wc.executeJavaScript(`(() => {
    const ed = window.__tiptap_editor;
    const p = document.querySelector('.tiptap p');
    const pos = p ? ed.view.posAtDOM(p, 0) : 1;
    ed.chain().focus().setTextSelection(pos).run();
    return true;
  })()`);
  if (env.SPIKE_HIDE !== "1") win.focus();
  await sleep(1000);
  // after-storage arm: S2's worker commits 4 KB rows back to back while the
  // keys go in, and is still running when quit is requested.
  if (env.S5_MODE === "worker-commits")
    await (
      globalThis as unknown as { __s5: { start(): Promise<void> } }
    ).__s5.start();
  const typedFrom = performance.now();
  for (let i = 0; i < KEYS; i++) {
    await press(wc, "a");
    await sleep(KEY_DELAY_MS);
  }
  quitLog("typed", {
    keys: KEYS,
    typingMs: Math.round(performance.now() - typedFrom),
  });
  if (SETTLE_MS > 0) await sleep(SETTLE_MS);
  if (!KEEP_THROTTLE) {
    if (THROTTLE > 1)
      await wc.debugger.sendCommand("Emulation.setCPUThrottlingRate", {
        rate: 1,
      });
    wc.debugger.detach();
  }
  requestedAt = performance.now();
  quitLog("requested", { via: VIA, throttleKept: KEEP_THROTTLE });
  if (VIA === "app-quit") app.quit();
  else win.close();
};

if (env.QUIT_PROBE !== "0") {
  void app.whenReady().then(() =>
    drive().catch((error) => {
      quitLog("probe-failed", { error: String(error) });
      app.exit(3);
    }),
  );
}
