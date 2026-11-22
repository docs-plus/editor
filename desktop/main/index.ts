/**
 * TinyDocy desktop main process (desktop architecture §2, §6.3, §10).
 *
 * Order matters:
 * 1. A crash handler, so an uncaught error never opens a modal dialog
 *    (that is what hung #106's Windows runs).
 * 2. `userData` (test builds take `TINYDOCY_USER_DATA`), then the single-instance
 *    lock, which Electron keys on `userData`. A second instance hands its
 *    `argv` to the first and exits before registering anything.
 * 3. The privileged `app://` scheme, and macOS `open-file` / `open-url`
 *    listeners inside `will-finish-launching` (else first-launch opens are
 *    lost).
 * 4. On `ready`: protocol, session hardening, menu, IPC, the storage
 *    worker (in parallel with the first window), then the first window.
 *
 * Bundles find each other through `app.getAppPath()` (the staged app
 * folder), never `__dirname`, which Bun.build bakes in at build time.
 */
import { statSync } from "node:fs";
import { join } from "node:path";

import { app, type BrowserWindow } from "electron";

import { DEEP_LINK_SCHEME } from "../shared/app-identity";
import { StorageClient } from "../storage/client";
import { installAppProtocol, registerAppScheme } from "./app-protocol";
import {
  DEEP_LINK_WINDOW_MS,
  DEEP_LINK_WINDOWS,
  type DocExists,
  openDocFromLink,
} from "./deep-link-open";
import { diagnostics } from "./diagnostics";
import { createDocHandlers, errorCodeOf, ownerOf } from "./doc-handlers";
import { installIpc } from "./ipc";
import { type LaunchIntent, parseLaunchArgs, userArgs } from "./launch-args";
import { installMenu } from "./menu";
import { QuitCoordinator } from "./quit-coordinator";
import { FixedWindowLimiter } from "./rate-limit";
import { OpenDocRegistry } from "./registry";
import { hardenSession } from "./session-hardening";
import { installSpellcheckGuard } from "./spellcheck";
import { StorageSupervisor } from "./storage-supervisor";
import { testHooks } from "./test-hooks";
import { hidden, WindowManager } from "./windows";

/**
 * The library folder (P2.6 hand-off §2; plan appendix A): under `userData`,
 * except on Windows, where `userData` is the roaming profile and a SQLite
 * library must stay local: `%LOCALAPPDATA%\TinyDocy\library`. A test
 * userData keeps everything in one folder.
 */
function libraryDir(): string {
  if (
    process.platform === "win32" &&
    !testHooks?.userData &&
    process.env.LOCALAPPDATA
  )
    return join(process.env.LOCALAPPDATA, "TinyDocy", "library");
  return join(app.getPath("userData"), "library");
}

/** The storage owner that checks a deep link's document exists. */
const PROBE_OWNER = "deep-link-probe";

/** Set by the build (`desktop/build/build.ts`) from the renderer's build env. */
const SYNC_URL = process.env.TINYDOCY_SYNC_URL ?? "ws://127.0.0.1:1234";
const RUNTIME_STYLE_HASHES: string[] = JSON.parse(
  process.env.TINYDOCY_RUNTIME_STYLE_HASHES ?? "[]",
);

process.on("uncaughtException", (error) => {
  diagnostics.log("uncaught_exception", { name: error?.name ?? "?" });
});
process.on("unhandledRejection", () => {
  diagnostics.log("unhandled_rejection");
});

if (testHooks?.userData) app.setPath("userData", testHooks.userData);

const isPrimary = app.requestSingleInstanceLock();
if (!isPrimary) {
  app.exit(0);
} else {
  start();
}

function start(): void {
  diagnostics.log("main_start");
  registerAppScheme();
  // Before any session exists: Linux spellcheck must never fetch (#100).
  installSpellcheckGuard();
  if (hidden && process.platform === "darwin") {
    app.setActivationPolicy("accessory");
    app.dock?.hide();
  }

  const appPath = app.getAppPath();
  const registry = new OpenDocRegistry();
  let ready = false;
  const pending: Array<{ args: string[]; cwd: string }> = [];

  const storage = new StorageSupervisor({
    registry,
    start: (events) =>
      StorageClient.start(
        join(appPath, "worker.cjs"),
        { dir: libraryDir() },
        events,
      ).then((client) => {
        diagnostics.log("storage_started", {
          readyMs: Math.round(client.timings.readyMs),
          readOnly: client.status.readOnly ?? "no",
        });
        return client;
      }),
    log: (event, fields) => diagnostics.log(event, fields),
    onIndexChanged: (rev, changes) => {
      for (const id of windows.ids())
        windows.get(id)?.webContents.send("index.changed", { rev, changes });
    },
  });

  const quit = new QuitCoordinator({
    windowIds: () => windows.ids(),
    requestFlush: (windowId, requestId, reason) => {
      const window = windows.get(windowId);
      if (!window) throw new Error("window gone");
      window.webContents.send("app.flushRequested", { requestId, reason });
    },
    shutdownStorage: (ms) => storage.shutdown(ms),
    exit: (code) => app.exit(code),
    now: () => performance.now(),
    setTimer: (ms, run) => {
      const timer = setTimeout(run, ms);
      return { cancel: () => clearTimeout(timer) };
    },
    mark: (mark, fields) => diagnostics.log(mark, fields),
  });

  const windows: WindowManager = new WindowManager(appPath, {
    onClosed: (windowId) => {
      registry.releaseWindow(windowId);
      handlers.forgetWindow(windowId);
      quit.forgetWindow(windowId);
      if (quit.phase === "running")
        void storage
          .call("releaseOwner", { owner: ownerOf(windowId) })
          .catch(() => undefined);
    },
    onCloseRequested: (window: BrowserWindow) => {
      const id = window.id;
      if (quit.phase !== "running") {
        window.destroy();
        return;
      }
      void quit.flushWindows([id], "close").then((unanswered) => {
        diagnostics.log("window_close_flushed", { unanswered });
        if (!window.isDestroyed()) window.destroy();
      });
    },
    onNewDocument: (windowId) => handlers.forgetWindow(windowId),
    onRendererGone: (window: BrowserWindow) => {
      // Architecture §6.2: the document goes to Closing. In-flight appends
      // died with the renderer; the worker forgets this owner.
      const id = window.id;
      registry.releaseWindow(id);
      handlers.forgetWindow(id);
      quit.forgetWindow(id);
      void storage
        .call("releaseOwner", { owner: ownerOf(id) })
        .catch(() => undefined);
      if (quit.phase !== "running" || window.isDestroyed()) return;
      const now = Date.now();
      const last = rendererReloads.get(id) ?? 0;
      if (now - last < 60_000) {
        diagnostics.log("renderer_gone_closed", { window: id });
        window.destroy();
        return;
      }
      rendererReloads.set(id, now);
      // The window keeps its document: claim it again unless another
      // window took it meanwhile, then reload (the page says hello again).
      const docId = windows.docOf(id);
      if (docId) registry.claim(docId, id);
      window.webContents.reload();
    },
  });
  const rendererReloads = new Map<number, number>();

  const handlers = createDocHandlers({
    registry,
    call: storage.call,
    focusWindow: (windowId) => windows.focus(windowId),
    windowDoc: (windowId) => windows.docOf(windowId),
    onFlushed: (windowId, requestId) =>
      quit.confirmFlushed(windowId, requestId),
  });

  const focusOrCreate = () => {
    const window = windows.latest();
    if (window) windows.focus(window.id);
    else windows.create(null);
  };

  /**
   * Does the library have this document? A probe owner claims and releases
   * it (no new worker op). `already_open` means it exists; any other
   * failure means storage can't tell.
   */
  const docExists = async (docId: string): Promise<DocExists> => {
    try {
      await storage.call("claim", { docId, owner: PROBE_OWNER });
      await storage
        .call("close", { docId, owner: PROBE_OWNER })
        .catch(() => undefined);
      return "yes";
    } catch (error) {
      const code = errorCodeOf(error);
      if (code === "not_found") return "no";
      if (code === "already_open") return "yes";
      return "unknown";
    }
  };

  const deepLinkLimiter = new FixedWindowLimiter(
    DEEP_LINK_WINDOWS,
    DEEP_LINK_WINDOW_MS,
  );

  const openDoc = async (docId: string): Promise<void> => {
    const outcome = await openDocFromLink(docId, {
      registry,
      isOurs: (windowId) => windows.isOurs(windowId),
      focus: (windowId) => windows.focus(windowId),
      create: (id) => windows.create(id),
      discard: (windowId) => windows.get(windowId)?.destroy(),
      docExists,
      limiter: deepLinkLimiter,
      log: (event, fields) => diagnostics.log(event, fields),
    });
    // A link that opened nothing still brings the app forward.
    if (outcome !== "opened" && outcome !== "focused") focusOrCreate();
  };

  const route = async (intents: LaunchIntent[]): Promise<void> => {
    for (const intent of intents) {
      if (intent.kind === "openDoc") await openDoc(intent.docId);
      else if (intent.kind === "openFile") {
        // Import is P2.8: the file is accepted, nothing reads it yet.
        diagnostics.log("open_file_accepted", { type: intent.type });
        focusOrCreate();
      } else focusOrCreate();
    }
  };

  const isFile = (path: string) => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  };

  /**
   * Filters and routes one set of arguments. `accepted` is how many passed
   * the filter; `routed` settles once each has been opened or refused.
   */
  const handleArgs = (
    args: string[],
    cwd: string,
  ): { accepted: number; routed: Promise<void> } => {
    if (!ready) {
      pending.push({ args, cwd });
      return { accepted: 0, routed: Promise.resolve() };
    }
    const { intents, refused } = parseLaunchArgs(args, { cwd, isFile });
    if (refused > 0) diagnostics.log("argv_refused", { count: refused });
    diagnostics.log("argv_accepted", { count: intents.length });
    return {
      accepted: intents.length,
      routed: route(intents).catch(() => {
        diagnostics.log("route_failed");
      }),
    };
  };

  app.on("will-finish-launching", () => {
    app.on("open-file", (event, path) => {
      event.preventDefault();
      handleArgs([path], process.cwd());
    });
    app.on("open-url", (event, url) => {
      event.preventDefault();
      handleArgs([url], process.cwd());
    });
  });

  app.on("second-instance", (_event, argv, workingDirectory) => {
    diagnostics.log("second_instance");
    const { accepted } = handleArgs(
      userArgs(argv, Boolean(process.defaultApp)),
      workingDirectory,
    );
    // A second launch with nothing (or only refused things) to open.
    if (accepted === 0) focusOrCreate();
  });

  app.on("before-quit", (event) => {
    if (quit.phase === "exiting") return;
    // Main owns quitting: hold it until every window flushed (or 3 s) and
    // the worker checkpointed (or 2 s). Re-entrant calls are ignored.
    event.preventDefault();
    void quit.quit();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (ready && windows.ids().length === 0) windows.create(null);
  });

  app.whenReady().then(async () => {
    diagnostics.log("app_ready");
    installAppProtocol({
      rendererDir: join(appPath, "renderer"),
      syncUrl: SYNC_URL,
      runtimeStyleHashes: RUNTIME_STYLE_HASHES,
    });
    hardenSession();
    installMenu();
    installIpc(handlers, windows);
    const storageReady = storage.start();
    if (app.isPackaged && process.platform === "win32")
      // `"…\TinyDocy.exe" -- "%1"`: the link is always last and after
      // `--`, so it can never be read as a switch (SEC-001).
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME, process.execPath, [
        "--",
      ]);

    // The first launch's own arguments, plus any macOS open-file /
    // open-url that arrived before ready, decide the first window(s); a
    // window with no document opens only if none of them made one. A plain
    // launch opens its window at once; a deep link waits for storage to
    // confirm the document exists (SEC-005).
    ready = true;
    const routed = [
      handleArgs(
        userArgs(process.argv, Boolean(process.defaultApp)),
        process.cwd(),
      ).routed,
      ...pending.splice(0).map(({ args, cwd }) => handleArgs(args, cwd).routed),
    ];
    await Promise.all(routed);
    if (windows.ids().length === 0) windows.create(null);

    // Installer smoke (CI): start, show the first window, open the library,
    // then quit through the normal path and exit 0.
    if (testHooks?.quitAfterReady) {
      const first = windows.latest();
      const shown = new Promise<void>((resolve) => {
        if (!first) resolve();
        else first.webContents.once("did-finish-load", () => resolve());
      });
      void Promise.all([storageReady, shown]).then(() => {
        diagnostics.log("self_test_ready", { storage: storage.state });
        setTimeout(() => app.quit(), 1000);
      });
    }
  });
}
