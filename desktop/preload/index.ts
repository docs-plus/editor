/**
 * The sandboxed preload (CJS; its only `require` is `electron`). It puts
 * one object on the page, `window.tinydocy` (desktop architecture §7):
 * - `invoke(channel, args)`: forwards to main and returns main's
 *   `IpcResult`. Every call waits for `app.hello`, which sends this build's
 *   id first: main refuses calls from a window that hasn't said hello with
 *   the same build.
 * - `on(event, listener)`: main's events. For `app.flushRequested` the
 *   preload answers `app.flushed` once every listener's promise settles, or
 *   at once when the page has none, so a quit never waits on a page that
 *   keeps nothing unsaved in memory.
 *
 * It validates nothing: main is the trust boundary. It never exposes
 * `ipcRenderer` itself.
 */
import { contextBridge, type IpcRendererEvent, ipcRenderer } from "electron";

import {
  type CallChannel,
  EVENT_CHANNELS,
  type EventChannel,
  IPC_BUILD,
  isCallChannel,
  type TinydocyBridge,
} from "../shared/ipc-contract";

type Listener = (payload: unknown) => void | Promise<void>;

const listeners = new Map<EventChannel, Set<Listener>>(
  EVENT_CHANNELS.map((channel) => [channel, new Set<Listener>()]),
);

const hello: Promise<unknown> = ipcRenderer.invoke("app.hello", {
  build: IPC_BUILD,
});

const invoke = async (channel: CallChannel, args: unknown) => {
  if (channel === "app.hello") return hello;
  await hello;
  return ipcRenderer.invoke(channel, args);
};

for (const channel of EVENT_CHANNELS) {
  ipcRenderer.on(channel, (_event: IpcRendererEvent, payload: unknown) => {
    const set = listeners.get(channel) ?? new Set<Listener>();
    const runs = [...set].map(async (listener) => listener(payload));
    if (channel !== "app.flushRequested") return;
    const { requestId } = payload as { requestId: number };
    void Promise.allSettled(runs).then(() =>
      invoke("app.flushed", { requestId }),
    );
  });
}

// CSP violations go to main's diagnostics: the directive and the blocked
// URL's scheme only, never the URL.
document.addEventListener("securitypolicyviolation", (event) => {
  const blocked = event.blockedURI;
  const scheme = /^[a-z][a-z0-9+.-]*:/i.exec(blocked)?.[0] ?? blocked;
  ipcRenderer.send("diag.csp", event.effectiveDirective, scheme.slice(0, 20));
});

const bridge: TinydocyBridge = {
  build: IPC_BUILD,
  invoke: ((channel: unknown, args: unknown) => {
    if (!isCallChannel(channel))
      return Promise.resolve({
        ok: false,
        error: { code: "invalid_argument", retryable: false },
      });
    return invoke(channel, args);
  }) as TinydocyBridge["invoke"],
  on: ((channel: EventChannel, listener: Listener) => {
    const set = listeners.get(channel);
    if (!set || typeof listener !== "function") return () => undefined;
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }) as TinydocyBridge["on"],
};

contextBridge.exposeInMainWorld("tinydocy", bridge);
