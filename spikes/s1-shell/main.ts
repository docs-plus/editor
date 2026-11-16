/**
 * Spike S1 main process: hosts the static export on one of the two D-A11
 * candidate origins and records what the write-up needs.
 *
 * SPIKE_ORIGIN=app   -> app://tinydocy (privileged standard + secure scheme)
 * SPIKE_ORIGIN=https -> https://app.tinydocy.invalid via protocol.handle("https")
 *
 * State for the Playwright spec lives on globalThis.__s1 (read with
 * electronApp.evaluate).
 */
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";

import {
  app,
  BrowserWindow,
  type IpcMainInvokeEvent,
  ipcMain,
  net,
  protocol,
  session,
} from "electron";

import { buildDesktopCsp, hashInline, type StyleMode } from "./csp";
import { installMenu, type MenuIntent } from "./menu";

const ORIGIN_KIND = process.env.SPIKE_ORIGIN === "https" ? "https" : "app";
const APP_HOST = ORIGIN_KIND === "https" ? "app.tinydocy.invalid" : "tinydocy";
const ORIGIN =
  ORIGIN_KIND === "https" ? `https://${APP_HOST}` : `app://${APP_HOST}`;
/**
 * Bun.build (target node) bakes `__dirname` into the bundle as the absolute
 * source directory, so the bundle locates itself through Electron instead.
 */
const HERE = app.getAppPath().endsWith(".cjs")
  ? join(app.getAppPath(), "..")
  : app.getAppPath();
const OUT_DIR = resolve(
  process.env.SPIKE_OUT_DIR ??
    (app.isPackaged
      ? join(app.getAppPath(), "renderer")
      : join(HERE, "../../../out")),
);
const HOCUS_URL = process.env.SPIKE_HOCUS_URL ?? "ws://127.0.0.1:1234";
const STYLE_MODE: StyleMode =
  process.env.SPIKE_STYLE_MODE === "strict" ? "strict" : "attr-unsafe-inline";
const HEAD_PROBE = process.env.SPIKE_HEAD_PROBE === "1";
const YOUTUBE_REFERER =
  process.env.SPIKE_REFERER ?? "https://app.tinydocy.invalid/";
const REWRITE_REFERER = process.env.SPIKE_REFERER_REWRITE !== "0";
const REGISTER_ACCEL = process.env.SPIKE_REGISTER_ACCEL === "1";
/** https origin: copy Request.referrer into the forwarded Referer header. */
const FORWARD_REFERRER = process.env.SPIKE_FORWARD_REFERRER !== "0";

interface S1State {
  origin: string;
  marks: Record<string, number>;
  requests: { status: number; path: string }[];
  notFound: string[];
  inlineScripts: Record<string, number>;
  inlineStyles: Record<string, number>;
  ipc: {
    channel: string;
    accepted: boolean;
    frameUrl: string;
    top: boolean;
    reason?: string;
  }[];
  preloadFrames: string[];
  menuClicks: Record<string, number>;
  youtubeReferers: {
    url: string;
    original: string | null;
    sent: string | null;
  }[];
  spellcheck: string[];
  console: string[];
  rendererMarks: Record<string, number>;
  contextMenus: { misspelled: string; suggestions: string[] }[];
  documentNavigations: string[];
  inPageNavigations: string[];
}

const state: S1State = {
  origin: ORIGIN,
  marks: { mainModuleLoaded: performance.now() },
  requests: [],
  notFound: [],
  inlineScripts: {},
  inlineStyles: {},
  ipc: [],
  preloadFrames: [],
  menuClicks: {},
  youtubeReferers: [],
  spellcheck: [],
  console: [],
  rendererMarks: {},
  contextMenus: [],
  documentNavigations: [],
  inPageNavigations: [],
};
(globalThis as unknown as { __s1: S1State }).__s1 = state;

if (process.env.SPIKE_NETLOG) {
  app.commandLine.appendSwitch("log-net-log", process.env.SPIKE_NETLOG);
  app.commandLine.appendSwitch("net-log-capture-mode", "Default");
}
if (process.env.TINYDOCY_USER_DATA) {
  app.setPath("userData", process.env.TINYDOCY_USER_DATA);
}

if (ORIGIN_KIND === "app") {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "app",
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

// ---------------------------------------------------------------- assets

const ASSETS_DIR =
  process.env.SPIKE_ASSETS_DIR ?? mkdtempSync(join(tmpdir(), "s1-assets-"));
/** 1×1 red PNG, the `/_asset/<hex>` fixture. */
const FIXTURE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
  "base64",
);
export const FIXTURE_HEX = "a".repeat(64);
writeFileSync(join(ASSETS_DIR, FIXTURE_HEX), FIXTURE_PNG);

const ASSET_PATH = /^\/_asset\/([0-9a-f]{64})$/;

function serveAsset(rawPath: string): Response {
  const match = ASSET_PATH.exec(rawPath);
  if (!match) return notFound(rawPath);
  const file = join(ASSETS_DIR, match[1]);
  if (!existsSync(file)) return notFound(rawPath);
  return new Response(readFileSync(file), {
    headers: {
      "content-type": "image/png",
      "x-content-type-options": "nosniff",
    },
  });
}

// ---------------------------------------------------------------- static

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

function notFound(path: string): Response {
  state.notFound.push(path);
  state.requests.push({ status: 404, path });
  return new Response("Not found", { status: 404 });
}

function resolveStatic(pathname: string): string | null {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (rel.includes("\0")) return null;
  if (rel.endsWith("/")) rel += "index.html";
  const candidates = extname(rel)
    ? [rel]
    : [`${rel}.html`, `${rel}/index.html`];
  for (const candidate of candidates) {
    const abs = resolve(OUT_DIR, `.${candidate}`);
    if (!abs.startsWith(OUT_DIR + sep)) return null;
    if (existsSync(abs) && statSync(abs).isFile()) return abs;
  }
  return null;
}

const HEAD_PROBE_SCRIPT =
  '<script>console.log("[spike-head] dataset.spike=" + document.documentElement.dataset.spike)</script>';

function serveHtml(path: string, file: string): Response {
  let html = readFileSync(file, "utf8");
  if (HEAD_PROBE) html = html.replace("<head>", `<head>${HEAD_PROBE_SCRIPT}`);
  const hashes = hashInline(html);
  state.inlineScripts[path] = hashes.scripts.length;
  state.inlineStyles[path] = hashes.styles.length;
  const csp = buildDesktopCsp({
    hocusUrl: HOCUS_URL,
    hashes,
    styleMode: STYLE_MODE,
  });
  return new Response(html, {
    headers: {
      "content-type": MIME[".html"],
      "content-security-policy": csp,
      "x-content-type-options": "nosniff",
      "referrer-policy": "strict-origin-when-cross-origin",
    },
  });
}

const FRAME_TEST_HTML = `<!doctype html><html><head><title>frame test</title></head><body>
<iframe id="yt" width="320" height="180" src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>
</body></html>`;

function serveApp(request: Request): Response {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path.startsWith("/_asset/")) {
    const res = serveAsset(path);
    if (res.status === 200) state.requests.push({ status: 200, path });
    return res;
  }
  if (path.startsWith("/_dict/") && process.env.SPIKE_DICT_DIR) {
    // Bundled Hunspell dictionaries (Linux/Windows fallback), name-checked.
    const name = path.slice("/_dict/".length).toLowerCase();
    const file = join(process.env.SPIKE_DICT_DIR, name);
    if (
      !/^[a-z]{2}(-[a-z]{2})?-\d+-\d+\.bdic$/.test(name) ||
      !existsSync(file)
    ) {
      return notFound(path);
    }
    state.requests.push({ status: 200, path });
    return new Response(readFileSync(file), {
      headers: { "content-type": "application/octet-stream" },
    });
  }
  if (path === "/__spike/frame.html") {
    const hashes = hashInline(FRAME_TEST_HTML);
    return new Response(FRAME_TEST_HTML, {
      headers: {
        "content-type": MIME[".html"],
        "content-security-policy": buildDesktopCsp({
          hocusUrl: HOCUS_URL,
          hashes,
          styleMode: STYLE_MODE,
        }),
      },
    });
  }
  const file = resolveStatic(path);
  if (!file) return notFound(path + url.search);
  state.requests.push({ status: 200, path: path + url.search });
  if (file.endsWith(".html")) return serveHtml(path, file);
  return new Response(readFileSync(file), {
    headers: {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
    },
  });
}

function installProtocol(): void {
  if (ORIGIN_KIND === "app") {
    protocol.handle("app", (request) =>
      new URL(request.url).host === APP_HOST
        ? serveApp(request)
        : notFound(request.url),
    );
    return;
  }
  protocol.handle("https", (request) => {
    const host = new URL(request.url).host;
    if (host === APP_HOST) return serveApp(request);
    if (
      /(^|\.)youtube(-nocookie)?\.com$/.test(host) &&
      request.destination !== "script"
    ) {
      state.youtubeReferers.push({
        url: `[https-handler ${request.destination || "?"} referrer=${request.referrer}] ${request.url.slice(0, 80)}`,
        original: request.headers.get("referer"),
        sent: null,
      });
    }
    if (
      FORWARD_REFERRER &&
      request.referrer &&
      !request.headers.has("referer")
    ) {
      const headers = new Headers(request.headers);
      headers.set("Referer", request.referrer);
      return net.fetch(new Request(request, { headers }), {
        bypassCustomProtocolHandlers: true,
      });
    }
    return net.fetch(request, { bypassCustomProtocolHandlers: true });
  });
}

// ---------------------------------------------------------------- YouTube

function installRefererRewrite(): void {
  const filter = {
    urls: ["https://www.youtube.com/*", "https://www.youtube-nocookie.com/*"],
  };
  session.defaultSession.webRequest.onBeforeSendHeaders(
    filter,
    (details, callback) => {
      const headers = details.requestHeaders;
      const original = headers.Referer ?? headers.referer ?? null;
      const needs =
        ORIGIN_KIND === "app" &&
        REWRITE_REFERER &&
        details.resourceType === "subFrame" &&
        (!original || original.startsWith("app:"));
      if (needs) headers.Referer = YOUTUBE_REFERER;
      if (details.resourceType === "subFrame") {
        state.youtubeReferers.push({
          url: details.url.slice(0, 120),
          original,
          sent: headers.Referer ?? headers.referer ?? null,
        });
      }
      callback({ requestHeaders: headers });
    },
  );
}

// ---------------------------------------------------------------- IPC

const ourWindows = new Set<number>();

/** `new URL("app://tinydocy/").origin` is "null" in Node: compare scheme and host. */
function frameOrigin(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function checkSender(channel: string, event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  const frameUrl = frame?.url ?? "";
  const top = !!frame && frame.parent === null;
  const win = BrowserWindow.fromWebContents(event.sender);
  let reason: string | undefined;
  if (!frame) reason = "no_frame";
  else if (!top) reason = "not_top_frame";
  else if (!win || !ourWindows.has(win.id)) reason = "unknown_window";
  else if (frameOrigin(frameUrl) !== ORIGIN) reason = "wrong_origin";
  state.ipc.push({ channel, accepted: !reason, frameUrl, top, reason });
  return !reason;
}

function installIpc(): void {
  ipcMain.handle("spike.ping", (event) => {
    const ok = checkSender("spike.ping", event);
    return ok
      ? {
          ok: true,
          value: {
            nodeUrlOrigin: new URL(event.senderFrame?.url ?? "x:").origin,
          },
        }
      : { ok: false, error: { code: "sender_refused", retryable: false } };
  });
  ipcMain.on("spike.preloadRan", (_event, href: string) => {
    state.preloadFrames.push(href);
  });
  ipcMain.on("spike.mark", (_event, name: string) => {
    state.rendererMarks[name] ??= performance.now();
  });
  ipcMain.on("spike.history", (_event, canUndo: boolean, canRedo: boolean) => {
    menu.setHistory(canUndo, canRedo);
  });
}

// ---------------------------------------------------------------- windows

let menu: ReturnType<typeof installMenu>;

function createWindow(path = "/", frameTest = false): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    show: process.env.SPIKE_HIDE !== "1",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: join(HERE, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      nodeIntegrationInSubFrames: frameTest,
    },
  });
  ourWindows.add(win.id);
  state.marks.windowCreated ??= performance.now();
  win.webContents.on("console-message", (details) => {
    const line = `[${details.level}] ${details.message}`;
    state.console.push(line.slice(0, 500));
    if (process.env.SPIKE_ECHO_CONSOLE === "1")
      console.log(`[renderer] ${line}`);
  });
  win.webContents.on("context-menu", (_event, params) => {
    state.contextMenus.push({
      misspelled: params.misspelledWord,
      suggestions: params.dictionarySuggestions,
    });
  });
  win.webContents.on("did-navigate", (_event, url) => {
    state.documentNavigations.push(url);
  });
  win.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) state.inPageNavigations.push(url);
  });
  win.webContents.once("did-finish-load", () => {
    state.marks.didFinishLoad ??= performance.now();
  });
  win.loadURL(`${ORIGIN}${path}`);
  return win;
}

function sendIntent(intent: MenuIntent): void {
  state.menuClicks[intent] = (state.menuClicks[intent] ?? 0) + 1;
  const win =
    BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  win?.webContents.send("app.menuIntent", intent);
}

app.whenReady().then(() => {
  state.marks.ready = performance.now();
  installProtocol();
  installRefererRewrite();
  installIpc();
  if (process.env.SPIKE_DICT_URL) {
    session.defaultSession.setSpellCheckerDictionaryDownloadURL(
      process.env.SPIKE_DICT_URL,
    );
  }
  for (const evt of [
    "spellcheck-dictionary-initialized",
    "spellcheck-dictionary-download-begin",
    "spellcheck-dictionary-download-success",
    "spellcheck-dictionary-download-failure",
  ] as const) {
    session.defaultSession.on(
      evt as "spellcheck-dictionary-initialized",
      (_e, lang: string) => {
        state.spellcheck.push(`${evt}:${lang}`);
      },
    );
  }
  if (process.platform !== "darwin") {
    session.defaultSession.setSpellCheckerLanguages(["en-US"]);
  }
  menu = installMenu({
    registerAccelerator: REGISTER_ACCEL,
    onIntent: sendIntent,
  });
  createWindow();
  if (process.env.SPIKE_FRAME_TEST === "1")
    createWindow("/__spike/frame.html", true);
  console.log(
    `[s1] origin=${ORIGIN} appPath=${app.getAppPath()} out=${OUT_DIR} style=${STYLE_MODE}`,
  );
});

app.on("window-all-closed", () => app.quit());
