import { HocuspocusProviderWebsocket } from "@hocuspocus/provider";

import { withClientVersion } from "@/lib/schema-version";

declare global {
  interface Window {
    __HOCUS_URL?: string;
    __HOCUS_TOKEN?: string;
    /** E2E: per-test global-tabs doc for isolation (e.g. global-tabs-{docId}) */
    __GLOBAL_TABS_DOC?: string;
  }
}

export function getGlobalTabsDoc(): string {
  if (typeof window !== "undefined" && window.__GLOBAL_TABS_DOC) {
    return window.__GLOBAL_TABS_DOC;
  }
  return "global-tabs";
}

export function getHocuspocusWsUrl(): string {
  if (typeof window !== "undefined" && window.__HOCUS_URL) {
    return window.__HOCUS_URL;
  }
  if (
    typeof window !== "undefined" &&
    typeof process.env.NEXT_PUBLIC_HOCUS_URL === "string" &&
    process.env.NEXT_PUBLIC_HOCUS_URL
  ) {
    return process.env.NEXT_PUBLIC_HOCUS_URL;
  }
  if (
    typeof window !== "undefined" &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1"
  ) {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/collab`;
  }
  return "ws://127.0.0.1:1234";
}

export function getHocuspocusToken(): string | undefined {
  if (typeof window !== "undefined" && window.__HOCUS_TOKEN) {
    return window.__HOCUS_TOKEN;
  }
  return undefined;
}

let sharedSocket: HocuspocusProviderWebsocket | null = null;

/**
 * One WebSocket for every document this tab opens (tab list and editor).
 * A separate socket per document costs an extra TCP/TLS handshake and
 * upgrade before the editor can sync. Providers built on it must call
 * `attach()`; `destroy()` on a provider then leaves the socket open.
 */
export function getSharedHocuspocusSocket(): HocuspocusProviderWebsocket {
  sharedSocket ??= new HocuspocusProviderWebsocket({
    url: withClientVersion(getHocuspocusWsUrl()),
  });
  return sharedSocket;
}
