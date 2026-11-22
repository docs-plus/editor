/**
 * The desktop renderer never registers the service worker (#117 follow-up):
 * the worker precaches web-only pages (`SHELL_PATHS` has `/privacy`), and
 * the desktop export has none of them.
 */
import { afterEach, describe, expect, it } from "bun:test";

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
  function fakeContainer(controlled: boolean) {
    const target = new EventTarget();
    const posted: unknown[] = [];
    const worker = { postMessage: (message: unknown) => posted.push(message) };
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

  it("posts the loaded files once, when the worker takes control", async () => {
    const { cacheLoadedFilesOnControl } = await load();
    const { container, posted, takeControl } = fakeContainer(false);
    cacheLoadedFilesOnControl(container);
    expect(posted).toEqual([]);
    takeControl();
    takeControl(); // an update later: already cached through the worker
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: "tinydocy:cache-loaded" });
    expect(Array.isArray((posted[0] as { urls: unknown }).urls)).toBe(true);
  });

  it("does nothing on a page the worker already controls", async () => {
    const { cacheLoadedFilesOnControl } = await load();
    const { container, posted, takeControl } = fakeContainer(true);
    cacheLoadedFilesOnControl(container);
    takeControl();
    expect(posted).toEqual([]);
  });

  it("stops listening on cleanup", async () => {
    const { cacheLoadedFilesOnControl } = await load();
    const { container, posted, takeControl } = fakeContainer(false);
    cacheLoadedFilesOnControl(container)();
    takeControl();
    expect(posted).toEqual([]);
  });
});
