/**
 * Session-wide hardening (plan §7; hardening checklist P2.5; spike S1):
 * - permissions are denied by default; the app origin may write to the
 *   clipboard, and a media player frame may go full screen;
 * - every web contents: navigation away from the app origin is refused,
 *   `window.open` is refused, and only an `https` link from the app's own
 *   top frame goes to the system browser, a few per window at most
 *   (SEC-003, `external-links.ts`); `<webview>` can't attach, and an
 *   unload veto is ignored (#106: the quit coordinator owns quitting);
 * - downloads are refused until managed export lands (SEC-004), and
 *   Bluetooth, HID, serial and USB choosers are dismissed;
 * - YouTube player frames get a web Referer (D-A11: Error 153 without it);
 * - spellcheck is guarded per session from `index.ts` (`spellcheck.ts`; off
 *   on Linux, #100).
 */
import {
  app,
  session,
  shell,
  type WebContents,
  type WebFrameMain,
} from "electron";

import { APP_ORIGIN, EMBED_REFERER } from "../shared/app-identity";
import { DESKTOP_FRAME_HOSTS } from "./csp";
import { diagnostics } from "./diagnostics";
import { ExternalLinkGate } from "./external-links";
import { testHooks } from "./test-hooks";

/** `${protocol}//${host}`: Node's `.origin` is "null" for `app:` (S1). */
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

export const isAppUrl = (url: string) => originOf(url) === APP_ORIGIN;

const externalLinks = new ExternalLinkGate();

/** The app's own top frame: no parent, on `app://tinydocy`. */
function isTopAppFrame(frame: WebFrameMain | null | undefined): boolean {
  try {
    return !!frame && frame.parent === null && isAppUrl(frame.url);
  } catch {
    // A frame that was destroyed meanwhile can't be asked anything.
    return false;
  }
}

/**
 * Sends `url` to the system browser if the gate allows it (SEC-003): an
 * `https:` URL, from the app's top frame, within the per-window rate.
 * Everything else is refused without a browser ever opening. Test builds
 * can log instead of opening (`test-hooks.ts`).
 */
export function openExternally(
  windowId: number,
  url: string,
  fromTopAppFrame: boolean,
): boolean {
  const decision = externalLinks.decide({
    windowId,
    url,
    fromTopAppFrame,
    now: Date.now(),
  });
  if (decision.action === "refuse") {
    if (decision.reason === "frame")
      diagnostics.log("external_open_refused", { reason: "frame" });
    else if (decision.reason === "rate" && decision.rateLimitedFirst)
      diagnostics.log("external_open_refused", { reason: "rate" });
    return false;
  }
  diagnostics.log("external_open");
  if (!testHooks?.externalOpenLogOnly)
    void shell.openExternal(decision.url).catch(() => {
      diagnostics.log("external_open_failed");
    });
  return true;
}

const FRAME_ORIGINS = new Set(DESKTOP_FRAME_HOSTS);

function hardenWebContents(contents: WebContents): void {
  const windowId = contents.id;
  contents.once("destroyed", () => externalLinks.forget(windowId));

  contents.on("will-navigate", (event) => {
    if (!event.isMainFrame || isAppUrl(event.url)) return;
    event.preventDefault();
    diagnostics.log("navigation_refused");
    // Only a navigation the app's top frame started (a link the user
    // clicked in the document) may go to the browser; one an embed
    // started, by navigating the top window, may not.
    openExternally(windowId, event.url, isTopAppFrame(event.initiator));
  });
  contents.on("will-redirect", (event, url, _inPlace, isMainFrame) => {
    if (!isMainFrame || isAppUrl(url)) return;
    event.preventDefault();
    diagnostics.log("redirect_refused");
  });
  contents.setWindowOpenHandler(({ url, referrer }) => {
    diagnostics.log("window_open_refused");
    // Electron doesn't say which frame called window.open. The app's own
    // links open with `noreferrer`, so the referrer alone can't tell; the
    // focused frame can: a click inside an embed focuses that embed. A
    // referrer from another origin is refused outright.
    // Unknown provenance is untrusted: no focused frame means no link.
    const focused = contents.focusedFrame;
    const fromTop =
      focused !== null &&
      isTopAppFrame(focused) &&
      (!referrer?.url || isAppUrl(referrer.url));
    openExternally(windowId, url, fromTop);
    return { action: "deny" };
  });
  // No device chooser on desktop (permissions are denied anyway).
  contents.on("select-bluetooth-device", (event, _devices, callback) => {
    event.preventDefault();
    callback("");
    diagnostics.log("device_refused", { kind: "bluetooth" });
  });
  contents.on("will-attach-webview", (event) => {
    event.preventDefault();
    diagnostics.log("webview_refused");
  });
  contents.on("will-prevent-unload", (event) => {
    // preventDefault here means "unload anyway".
    event.preventDefault();
    diagnostics.log("unload_veto_ignored");
  });
}

export function hardenSession(): void {
  const ses = session.defaultSession;

  ses.setPermissionRequestHandler(
    (_contents, permission, callback, details) => {
      const origin = originOf(details.requestingUrl ?? "");
      const allowed =
        (permission === "clipboard-sanitized-write" && origin === APP_ORIGIN) ||
        (permission === "fullscreen" && !!origin && FRAME_ORIGINS.has(origin));
      if (!allowed) diagnostics.log("permission_refused", { permission });
      callback(allowed);
    },
  );
  ses.setPermissionCheckHandler(
    (_contents, permission, requestingOrigin) =>
      permission === "clipboard-sanitized-write" &&
      originOf(requestingOrigin) === APP_ORIGIN,
  );
  ses.setDevicePermissionHandler(() => false);
  ses.on("select-hid-device", (event, _details, callback) => {
    event.preventDefault();
    callback();
    diagnostics.log("device_refused", { kind: "hid" });
  });
  ses.on("select-serial-port", (event, _ports, _contents, callback) => {
    event.preventDefault();
    callback("");
    diagnostics.log("device_refused", { kind: "serial" });
  });
  ses.on("select-usb-device", (event, _details, callback) => {
    event.preventDefault();
    callback();
    diagnostics.log("device_refused", { kind: "usb" });
  });
  // No downloads until managed export (P2.8) owns them (SEC-004).
  ses.on("will-download", (event) => {
    event.preventDefault();
    diagnostics.log("download_refused");
  });

  ses.webRequest.onBeforeSendHeaders(
    {
      urls: ["https://www.youtube.com/*", "https://www.youtube-nocookie.com/*"],
    },
    (details, callback) => {
      const headers = details.requestHeaders;
      const referer = headers.Referer ?? headers.referer;
      if (
        details.resourceType === "subFrame" &&
        (!referer || referer.startsWith("app:"))
      ) {
        delete headers.referer;
        headers.Referer = EMBED_REFERER;
      }
      callback({ requestHeaders: headers });
    },
  );

  app.on("web-contents-created", (_event, contents) =>
    hardenWebContents(contents),
  );

  // Last, so nothing above can be skipped if a spellcheck call throws.
}
