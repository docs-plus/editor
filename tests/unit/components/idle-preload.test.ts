import { afterEach, describe, expect, it, mock } from "bun:test";

import { preloadWhenIdle } from "@/components/smart-toolbar/idle-preload";

type IdleWindow = {
  requestIdleCallback?: Window["requestIdleCallback"];
  cancelIdleCallback?: Window["cancelIdleCallback"];
};

const win = window as unknown as IdleWindow;
const realRequest = win.requestIdleCallback;
const realCancel = win.cancelIdleCallback;

afterEach(() => {
  win.requestIdleCallback = realRequest;
  win.cancelIdleCallback = realCancel;
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("preloadWhenIdle", () => {
  it("loads once the browser is idle, not before", () => {
    let idle: (() => void) | undefined;
    win.requestIdleCallback = ((callback: () => void) => {
      idle = callback;
      return 7;
    }) as Window["requestIdleCallback"];
    const load = mock(() => Promise.resolve());
    preloadWhenIdle(load);
    expect(load).not.toHaveBeenCalled();
    idle?.();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("cancels the idle callback when the caller unmounts first", () => {
    const cancel = mock((_id: number) => {});
    win.requestIdleCallback = (() => 7) as Window["requestIdleCallback"];
    win.cancelIdleCallback = cancel as Window["cancelIdleCallback"];
    const stop = preloadWhenIdle(() => Promise.resolve());
    stop();
    expect(cancel).toHaveBeenCalledWith(7);
  });

  it("falls back to a timer without requestIdleCallback", async () => {
    win.requestIdleCallback = undefined;
    const load = mock(() => Promise.resolve());
    preloadWhenIdle(load, 0);
    expect(load).not.toHaveBeenCalled();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("swallows a failed chunk fetch (the surface retries when opened)", async () => {
    win.requestIdleCallback = undefined;
    const load = mock(() => Promise.reject(new Error("offline")));
    preloadWhenIdle(load, 0);
    await settle();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
  });
});
