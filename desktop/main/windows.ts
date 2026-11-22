/**
 * Document windows (plan P2.5; UX design §2.3, §2.6, §3.1). One window per
 * document (D-A3). Each window:
 * - starts hidden and is shown on `ready-to-show`, over a background that
 *   matches the OS theme, so there is no white flash;
 * - runs sandboxed with context isolation and only the preload's bridge;
 * - can't zoom the page (visual zoom limited to 1, any zoom reset);
 * - has no reload or DevTools item in the menu (menu.ts);
 * - knows which document main opened it for (`app.hello` returns it).
 *
 * `TINYDOCY_HIDDEN=1` never shows a window (local smoke runs on a desktop
 * that must stay undisturbed).
 */
import { join } from "node:path";

import { app, BrowserWindow, nativeTheme } from "electron";

import { APP_ORIGIN } from "../shared/app-identity";
import { diagnostics } from "./diagnostics";
import { spellcheckEnabled } from "./session-hardening";

export const hidden = process.env.TINYDOCY_HIDDEN === "1";

const BACKGROUND = { light: "#ffffff", dark: "#0a0a0a" } as const;

export type WindowEvents = {
  /** The window is gone: release its claims and its storage owner. */
  onClosed: (windowId: number) => void;
  /** The user closed it: flush through the bridge first, then `destroy()`. */
  onCloseRequested: (window: BrowserWindow) => void;
  /** Its document reloaded or its renderer died: it must say hello again. */
  onNewDocument: (windowId: number) => void;
};

export class WindowManager {
  private readonly docs = new Map<number, string | null>();

  constructor(
    private readonly appPath: string,
    private readonly events: WindowEvents,
  ) {}

  isOurs(windowId: number): boolean {
    return this.docs.has(windowId);
  }

  /** The document main opened this window for. */
  docOf(windowId: number): string | null {
    return this.docs.get(windowId) ?? null;
  }

  ids(): number[] {
    return [...this.docs.keys()];
  }

  get(windowId: number): BrowserWindow | null {
    const window = BrowserWindow.fromId(windowId);
    return window && !window.isDestroyed() ? window : null;
  }

  /** The window to bring forward when nothing more specific is asked. */
  latest(): BrowserWindow | null {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused && this.isOurs(focused.id)) return focused;
    const ids = this.ids();
    return ids.length > 0 ? this.get(ids[ids.length - 1]) : null;
  }

  focus(windowId: number): void {
    const window = this.get(windowId);
    if (!window) return;
    diagnostics.log("window_focused", { window: windowId });
    if (hidden) return;
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }

  create(docId: string | null): BrowserWindow {
    const window = new BrowserWindow({
      width: 1200,
      height: 820,
      minWidth: 480,
      minHeight: 400,
      show: false,
      title: "TinyDocy",
      backgroundColor: nativeTheme.shouldUseDarkColors
        ? BACKGROUND.dark
        : BACKGROUND.light,
      webPreferences: {
        preload: join(this.appPath, "preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        nodeIntegrationInWorker: false,
        webviewTag: false,
        safeDialogs: true,
        navigateOnDragDrop: false,
        spellcheck: spellcheckEnabled,
        devTools: !app.isPackaged,
      },
    });
    const id = window.id;
    this.docs.set(id, docId);
    diagnostics.log("window_created", { window: id, forDoc: docId !== null });

    const contents = window.webContents;
    contents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
    contents.on("zoom-changed", () => {
      contents.setZoomLevel(0);
      diagnostics.log("zoom_refused");
    });
    contents.on("did-start-navigation", (details) => {
      if (details.isMainFrame && !details.isSameDocument)
        this.events.onNewDocument(id);
    });
    contents.on("render-process-gone", (_event, details) => {
      diagnostics.log("renderer_gone", { reason: details.reason });
      this.events.onNewDocument(id);
    });

    window.once("ready-to-show", () => {
      diagnostics.log("window_ready_to_show", { window: id });
      if (!hidden) window.show();
    });
    window.on("close", (event) => {
      event.preventDefault();
      this.events.onCloseRequested(window);
    });
    window.on("closed", () => {
      this.docs.delete(id);
      this.events.onClosed(id);
    });

    void window.loadURL(`${APP_ORIGIN}/`).catch(() => {
      diagnostics.log("window_load_failed", { window: id });
    });
    return window;
  }
}
