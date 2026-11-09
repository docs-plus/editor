import { WebSocketStatus } from "@hocuspocus/provider";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type ConnectionState,
  useConnectionState,
} from "@/hooks/use-connection-state";

/** Shared socket double: `setStatus()` emits `status` like the real one. */
const socket = vi.hoisted(() => {
  const handlers = new Set<() => void>();
  return {
    status: "connected" as string,
    connect: vi.fn(async () => {}),
    on(_event: string, handler: () => void) {
      handlers.add(handler);
    },
    off(_event: string, handler: () => void) {
      handlers.delete(handler);
    },
    setStatus(status: string) {
      this.status = status;
      for (const handler of handlers) handler();
    },
    listenerCount: () => handlers.size,
  };
});

vi.mock("@/lib/hocuspocus", () => ({
  getSharedHocuspocusSocket: () => socket,
}));

let browserOnline = true;
let root: Root;
const latest: { current?: ConnectionState } = {};

function Harness() {
  const state = useConnectionState();
  useEffect(() => {
    latest.current = state;
  });
  return null;
}

const state = () => latest.current;
const advance = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const setStatus = (status: WebSocketStatus) =>
  act(() => socket.setStatus(status));
const dispatch = (type: "online" | "offline") =>
  act(() => {
    window.dispatchEvent(new Event(type));
  });

function mount(status: WebSocketStatus): void {
  socket.status = status;
  root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Harness)));
}

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  browserOnline = true;
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => browserOnline,
  });
  socket.connect.mockClear();
  latest.current = undefined;
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe("useConnectionState", () => {
  it("is online while the socket is connected", () => {
    mount(WebSocketStatus.Connected);
    expect(state()).toBe("online");
  });

  it("says offline only after the grace period while the browser is online", () => {
    mount(WebSocketStatus.Connected);
    setStatus(WebSocketStatus.Disconnected);
    expect(state()).toBe("connecting");
    advance(3900);
    expect(state()).toBe("connecting");
    advance(100);
    expect(state()).toBe("offline");
  });

  it("does not restart the grace period on a reconnect attempt", () => {
    mount(WebSocketStatus.Connected);
    setStatus(WebSocketStatus.Disconnected);
    advance(2000);
    setStatus(WebSocketStatus.Connecting);
    expect(state()).toBe("connecting");
    advance(2000);
    expect(state()).toBe("offline");
  });

  it("is online again as soon as the socket connects", () => {
    mount(WebSocketStatus.Disconnected);
    advance(5000);
    expect(state()).toBe("offline");
    setStatus(WebSocketStatus.Connected);
    expect(state()).toBe("online");
  });

  it("says offline at once when the browser goes offline", () => {
    mount(WebSocketStatus.Connected);
    browserOnline = false;
    setStatus(WebSocketStatus.Disconnected);
    dispatch("offline");
    expect(state()).toBe("offline");
  });

  it("reconnects right away when the browser comes back online", () => {
    mount(WebSocketStatus.Disconnected);
    dispatch("online");
    expect(socket.connect).toHaveBeenCalledOnce();

    socket.connect.mockClear();
    setStatus(WebSocketStatus.Connecting);
    dispatch("online");
    expect(socket.connect).not.toHaveBeenCalled();
  });

  it("shares one watcher and stops it when the last caller unmounts", () => {
    mount(WebSocketStatus.Connected);
    const second = createRoot(document.createElement("div"));
    act(() => second.render(createElement(Harness)));
    expect(socket.listenerCount()).toBe(1);
    act(() => second.unmount());
    expect(socket.listenerCount()).toBe(1);
    act(() => root.unmount());
    expect(socket.listenerCount()).toBe(0);
    // afterEach unmounts `root` again: give it something to unmount.
    root = createRoot(document.createElement("div"));
  });
});
