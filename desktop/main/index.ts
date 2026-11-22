/**
 * TinyDocy desktop main process (desktop architecture §2, §6.3, §10).
 *
 * Order matters:
 * 1. A crash handler, so an uncaught error never opens a modal dialog
 *    (that is what hung #106's Windows runs).
 * 2. `userData` (tests pass `TINYDOCY_USER_DATA`), then the single-instance
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
import { diagnostics } from "./diagnostics";
import { createDocHandlers, ownerOf } from "./doc-handlers";
import { installIpc } from "./ipc";
import { type LaunchIntent, parseLaunchArgs, userArgs } from "./launch-args";
import { installMenu } from "./menu";
import { QuitCoordinator } from "./quit-coordinator";
import { OpenDocRegistry } from "./registry";
import { hardenSession } from "./session-hardening";
import { StorageSupervisor } from "./storage-supervisor";
import { hidden, WindowManager } from "./windows";

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

if (process.env.TINYDOCY_USER_DATA)
  app.setPath("userData", process.env.TINYDOCY_USER_DATA);

const isPrimary = app.requestSingleInstanceLock();
if (!isPrimary) {
  app.exit(0);
} else {
  start();
}

function start(): void {
  diagnostics.log("main_start");
  registerAppScheme();
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
        { dir: join(app.getPath("userData"), "library") },
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
  });

  const handlers = createDocHandlers({
    registry,
    call: storage.call,
    focusWindow: (windowId) => windows.focus(windowId),
    windowDoc: (windowId) => windows.docOf(windowId),
    onFlushed: (windowId, requestId) =>
      quit.confirmFlushed(windowId, requestId),
  });

  const openDoc = (docId: string) => {
    const holder = registry.holder(docId);
    if (holder !== undefined && windows.isOurs(holder)) {
      diagnostics.log("open_focused_existing", { window: holder });
      windows.focus(holder);
      return;
    }
    const window = windows.create(docId);
    registry.claim(docId, window.id);
  };

  const focusOrCreate = () => {
    const window = windows.latest();
    if (window) windows.focus(window.id);
    else windows.create(null);
  };

  const route = (intents: LaunchIntent[]) => {
    for (const intent of intents) {
      if (intent.kind === "openDoc") openDoc(intent.docId);
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

  const handleArgs = (args: string[], cwd: string, firstLaunch = false) => {
    if (!ready) {
      pending.push({ args, cwd });
      return;
    }
    const { intents, refused } = parseLaunchArgs(args, { cwd, isFile });
    if (refused > 0) diagnostics.log("argv_refused", { count: refused });
    diagnostics.log("argv_accepted", { count: intents.length });
    route(intents);
    if (firstLaunch && !intents.some((i) => i.kind === "openDoc")) {
      if (windows.ids().length === 0) windows.create(null);
    } else if (!firstLaunch && intents.length === 0) {
      // A second launch with nothing (or only refused things) to open.
      focusOrCreate();
    }
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
    handleArgs(userArgs(argv, Boolean(process.defaultApp)), workingDirectory);
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

  app.whenReady().then(() => {
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
      app.setAsDefaultProtocolClient(DEEP_LINK_SCHEME);

    ready = true;
    const early = pending.splice(0);
    handleArgs(
      userArgs(process.argv, Boolean(process.defaultApp)),
      process.cwd(),
      true,
    );
    for (const { args, cwd } of early) handleArgs(args, cwd);

    // Installer smoke (CI): start, show the first window, open the library,
    // then quit through the normal path and exit 0.
    if (process.env.TINYDOCY_QUIT_AFTER_READY === "1") {
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
