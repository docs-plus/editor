/**
 * Preloaded by `bun test` (bunfig.toml `[test] preload`): a happy-dom
 * window for the component, hook and editor tests.
 *
 * The Fetch API, WebSocket, abort and timer globals stay Bun's: server-side
 * code (Hocuspocus, SQLite, service-worker routing) runs on them in
 * production, and Bun's fake timers patch them. The DOM, including Blob,
 * File and Event, is happy-dom's, and so is `window.setTimeout`, which fake
 * timers do not control.
 */
import { afterEach } from "bun:test";

import { GlobalRegistrator } from "@happy-dom/global-registrator";

const NATIVE_GLOBALS = [
  "fetch",
  "Request",
  "Response",
  "Headers",
  "FormData",
  "URL",
  "WebSocket",
  "AbortController",
  "AbortSignal",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "queueMicrotask",
] as const;

const natives = NATIVE_GLOBALS.map((key) => [key, globalThis[key]] as const);
GlobalRegistrator.register({ url: "http://localhost/" });
for (const [key, value] of natives) {
  Object.assign(globalThis, { [key]: value });
}

afterEach(() => {
  localStorage.clear();
});
