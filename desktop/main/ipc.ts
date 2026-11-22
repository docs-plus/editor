/**
 * The IPC adapter (desktop architecture §7 "Sender checks"): every call
 * must come from the top frame of a window main created, whose URL is on
 * the app origin, on a channel the contract declares. Then the
 * Electron-free `doc-handlers` take over. A YouTube iframe has no preload,
 * and a frame that reaches `ipcRenderer` anyway is refused here.
 */
import { BrowserWindow, type IpcMainInvokeEvent, ipcMain } from "electron";

import { fail } from "../shared/errors";
import { CALL_CHANNELS, type CallChannel } from "../shared/ipc-contract";
import { diagnostics } from "./diagnostics";
import type { DocHandlers } from "./doc-handlers";
import { isAppUrl } from "./session-hardening";
import type { WindowManager } from "./windows";

/** CSP violations the preload reports, for diagnostics (directive only). */
export const CSP_REPORT_CHANNEL = "diag.csp";

function trustedWindowId(
  event: {
    sender: Electron.WebContents;
    senderFrame: Electron.WebFrameMain | null;
  },
  windows: WindowManager,
): number | null {
  const frame = event.senderFrame;
  if (!frame || frame.parent !== null) return null;
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || !windows.isOurs(window.id)) return null;
  if (!isAppUrl(frame.url)) return null;
  return window.id;
}

export function installIpc(
  handlers: DocHandlers,
  windows: WindowManager,
): void {
  for (const channel of CALL_CHANNELS) {
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, raw: unknown) => {
      const windowId = trustedWindowId(event, windows);
      if (windowId === null) {
        diagnostics.log("sender_refused", { channel });
        return fail("forbidden");
      }
      return handlers.dispatch(channel as CallChannel, windowId, raw);
    });
  }
  ipcMain.on(
    CSP_REPORT_CHANNEL,
    (event, directive: unknown, scheme: unknown) => {
      if (trustedWindowId(event, windows) === null) return;
      diagnostics.log("csp_violation", {
        directive: typeof directive === "string" ? directive : "?",
        scheme: typeof scheme === "string" ? scheme : "?",
      });
    },
  );
}
