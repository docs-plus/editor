import { test as base } from "@playwright/test";

import {
  type SpawnedStorageHost,
  spawnStorageHost,
} from "../../helpers/spawn-storage-host";

/**
 * The `local` project (architecture §11): the desktop renderer under a
 * desktop-target `next dev` with NEXT_PUBLIC_DESKTOP_BRIDGE=dev, and no Hocus.
 * Each worker starts its own dev storage host, so each worker has its own
 * library; every page gets that host's URL and token before it loads.
 */
export const test = base.extend<
  { bridgeOnPage: void },
  { storageHost: SpawnedStorageHost }
>({
  storageHost: [
    // biome-ignore lint/correctness/noEmptyPattern: Playwright reads a fixture's dependencies from this pattern; this one has none
    async ({}, use, workerInfo) => {
      const baseURL = workerInfo.project.use.baseURL ?? "";
      const host = await spawnStorageHost({ origin: new URL(baseURL).origin });
      await use(host);
      await host.stop();
    },
    { scope: "worker" },
  ],
  bridgeOnPage: [
    async ({ page, storageHost }, use) => {
      await page.addInitScript(
        (config) => {
          window.__TINYDOCY_DEV_BRIDGE = config;
        },
        { url: storageHost.url, token: storageHost.token },
      );
      await use();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
