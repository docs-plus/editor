/**
 * The desktop renderer never registers the service worker (#117 follow-up):
 * the worker precaches web-only pages (`SHELL_PATHS` has `/privacy`), and
 * the desktop export has none of them.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type RegistrationModule =
  typeof import("@/components/pwa/service-worker-registration");

const NODE_ENV = process.env.NODE_ENV;

async function enabledWith(env: Record<string, string>): Promise<boolean> {
  Object.assign(process.env, env);
  const { SERVICE_WORKER_ENABLED } = await importFresh<RegistrationModule>(
    "@/components/pwa/service-worker-registration",
  );
  return SERVICE_WORKER_ENABLED;
}

afterEach(() => {
  Object.assign(process.env, { NODE_ENV });
  delete process.env.NEXT_PUBLIC_APP_TARGET;
  delete process.env.NEXT_PUBLIC_SERVICE_WORKER;
  resetModules();
});

describe("SERVICE_WORKER_ENABLED", () => {
  it("web production build: on (unchanged)", async () => {
    expect(
      await enabledWith({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_TARGET: "web",
      }),
    ).toBe(true);
  });

  it("desktop build: off", async () => {
    expect(
      await enabledWith({
        NODE_ENV: "production",
        NEXT_PUBLIC_APP_TARGET: "desktop",
      }),
    ).toBe(false);
  });

  it("NEXT_PUBLIC_SERVICE_WORKER=0: off (unchanged)", async () => {
    expect(
      await enabledWith({
        NODE_ENV: "production",
        NEXT_PUBLIC_SERVICE_WORKER: "0",
      }),
    ).toBe(false);
  });
});

describe("cacheLoadedFilesOnControl", () => {
  const origin = location.origin;
  const entry = (path: string, workerStart: number) =>
    ({ name: `${origin}${path}`, workerStart }) as PerformanceResourceTiming;

  let loaded: PerformanceResourceTiming[] = [];
  let observers: Array<{
    callback: PerformanceObserverCallback;
    disconnected: boolean;
  }> = [];
  const realGetEntries = performance.getEntriesByType.bind(performance);
  const RealObserver = globalThis.PerformanceObserver;

  beforeEach(() => {
    loaded = [];
    observers = [];
    performance.getEntriesByType = (() =>
      loaded) as typeof performance.getEntriesByType;
    globalThis.PerformanceObserver = class {
      record: (typeof observers)[number];
      constructor(callback: PerformanceObserverCallback) {
        this.record = { callback, disconnected: false };
        observers.push(this.record);
      }
      observe() {}
      disconnect() {
        this.record.disconnected = true;
      }
    } as unknown as typeof PerformanceObserver;
  });

  afterEach(() => {
    performance.getEntriesByType = realGetEntries;
    globalThis.PerformanceObserver = RealObserver;
  });

  /** A resource entry that finishes after the worker took control. */
  function finishLater(...entries: PerformanceResourceTiming[]) {
    for (const observer of observers) {
      if (observer.disconnected) continue;
      observer.callback(
        {
          getEntries: () => entries,
        } as unknown as PerformanceObserverEntryList,
        {} as PerformanceObserver,
      );
    }
  }

  function fakeContainer(controlled: boolean) {
    const target = new EventTarget();
    const posted: Array<{ type: string; urls: string[] }> = [];
    const worker = {
      postMessage: (message: { type: string; urls: string[] }) =>
        posted.push(message),
    };
    const container = Object.assign(target, {
      controller: controlled ? worker : null,
    });
    const takeControl = () => {
      container.controller = worker;
      container.dispatchEvent(new Event("controllerchange"));
    };
    return {
      container: container as unknown as ServiceWorkerContainer,
      posted,
      takeControl,
    };
  }

  async function load() {
    return importFresh<RegistrationModule>(
      "@/components/pwa/service-worker-registration",
    );
  }

  it("posts the static files loaded without the worker once it takes control", async () => {
    const { cacheLoadedFilesOnControl } = await load();
    loaded = [
      entry("/_next/static/chunks/editor.js", 0),
      entry("/_next/static/chunks/through-worker.js", 12),
      entry("/api/documents/x", 0),
    ];
    const { container, posted, takeControl } = fakeContainer(false);
    cacheLoadedFilesOnControl(container);
    expect(posted).toEqual([]);
    takeControl();
    takeControl(); // an update later: already cached through the worker
    expect(posted).toEqual([
      {
        type: "tinydocy:cache-loaded",
        urls: ["/_next/static/chunks/editor.js"],
      },
    ]);
  });

  it("posts files requested before control that finish after it", async () => {
    const { cacheLoadedFilesOnControl } = await load();
    const { container, posted, takeControl } = fakeContainer(false);
    cacheLoadedFilesOnControl(container);
    takeControl();
    expect(posted).toEqual([]); // nothing loaded yet: no empty message
    finishLater(
      entry("/_next/static/chunks/bubble.js", 0),
      entry("/_next/static/chunks/palette.js", 8),
    );
    expect(posted).toEqual([
      {
        type: "tinydocy:cache-loaded",
        urls: ["/_next/static/chunks/bubble.js"],
      },
    ]);
  });

  it("does nothing on a page the worker already controls", async () => {
    const { cacheLoadedFilesOnControl } = await load();
    loaded = [entry("/_next/static/chunks/editor.js", 0)];
    const { container, posted, takeControl } = fakeContainer(true);
    cacheLoadedFilesOnControl(container);
    takeControl();
    expect(posted).toEqual([]);
    expect(observers).toEqual([]);
  });

  it("stops listening and observing on cleanup", async () => {
    const { cacheLoadedFilesOnControl } = await load();
    const first = fakeContainer(false);
    cacheLoadedFilesOnControl(first.container)();
    first.takeControl();
    expect(first.posted).toEqual([]);

    const second = fakeContainer(false);
    const stop = cacheLoadedFilesOnControl(second.container);
    second.takeControl();
    stop();
    finishLater(entry("/_next/static/chunks/late.js", 0));
    expect(second.posted).toEqual([]);
  });
});
