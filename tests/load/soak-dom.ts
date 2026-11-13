/**
 * A happy-dom window for standalone soak scripts (Tiptap needs a DOM). Like
 * `tests/setup.ts`, it keeps Bun's fetch, WebSocket and timers: the
 * Hocuspocus provider must talk to the real server on them. Import it first.
 */
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
