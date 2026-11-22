/**
 * Session-wide hardening (plan §7; hardening checklist P2.5; spike S1):
 * - permissions are denied by default; the app origin may write to the
 *   clipboard, and a media player frame may go full screen;
 * - every web contents: navigation away from the app origin is refused
 *   (an `https` link goes to the system browser), `window.open` is refused
 *   the same way, `<webview>` can't attach, and an unload veto is ignored
 *   (#106: the quit coordinator owns quitting);
 * - YouTube player frames get a web Referer (D-A11: Error 153 without it);
 * - Linux spellcheck stays off: Chromium's Hunspell download would reach
 *   Google's servers (#100), and no offline delivery is proven yet.
 */
import { app, session, shell, type WebContents } from "electron";

import { APP_ORIGIN, EMBED_REFERER } from "../shared/app-identity";
import { DESKTOP_FRAME_HOSTS } from "./csp";
import { diagnostics } from "./diagnostics";

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

/** `https:` URLs only, opened by the OS. Tests set TINYDOCY_EXTERNAL_OPEN=log. */
export function openExternally(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password)
    return false;
  diagnostics.log("external_open");
  if (process.env.TINYDOCY_EXTERNAL_OPEN !== "log")
    void shell.openExternal(parsed.href).catch(() => {
      diagnostics.log("external_open_failed");
    });
  return true;
}

const FRAME_ORIGINS = new Set(DESKTOP_FRAME_HOSTS);

export const spellcheckEnabled = process.platform !== "linux";

function hardenWebContents(contents: WebContents): void {
  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    diagnostics.log("navigation_refused");
    openExternally(url);
  });
  contents.on("will-redirect", (event, url, _inPlace, isMainFrame) => {
    if (!isMainFrame || isAppUrl(url)) return;
    event.preventDefault();
    diagnostics.log("redirect_refused");
  });
  contents.setWindowOpenHandler(({ url }) => {
    diagnostics.log("window_open_refused");
    openExternally(url);
    return { action: "deny" };
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

  if (!spellcheckEnabled) ses.setSpellCheckerEnabled(false);

  app.on("web-contents-created", (_event, contents) =>
    hardenWebContents(contents),
  );
}
