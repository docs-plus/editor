/// <reference lib="webworker" />

/**
 * Service worker, compiled by Next's native Turbopack entry to the permanent
 * URL /_next/static/service-worker/sw.js (registered only from
 * components/pwa/service-worker-registration.tsx). Type-checked by
 * tsconfig.sw.json. Never move it: installed clients keep updating from
 * that URL. Runbook: docs/operations/service-worker-runbook.md.
 *
 * - Navigations: network-first (navigation preload, 3 s timeout). A 5xx or
 *   no answer falls back to the last good copy of a shell page, then to the
 *   precached /offline page.
 * - /_next/static/*: cache-first (content-addressed).
 * - Everything else is never touched (see classifyRequest).
 */
import {
  CACHE_PREFIX,
  NAVIGATION_TIMEOUT_MS,
  OFFLINE_URL,
  SHELL_CACHE,
  SHELL_PATHS,
  STATIC_CACHE,
  STATIC_CACHE_MAX_ENTRIES,
} from "./sw-config";
import {
  classifyRequest,
  extractStaticAssets,
  isCacheableResponse,
} from "./sw-routing";

declare const self: ServiceWorkerGlobalScope;

/**
 * Emergency off switch: deploy with `true` AND NEXT_PUBLIC_SERVICE_WORKER=0.
 * The deployed worker then deletes its caches, unregisters and reloads the
 * tabs it controls once.
 */
const KILL_SWITCH: boolean = false;

const SHELL_PATH_SET = new Set<string>([...SHELL_PATHS, OFFLINE_URL]);

self.addEventListener("install", (event) => {
  void self.skipWaiting();
  if (KILL_SWITCH) return;
  event.waitUntil(
    Promise.all([
      snapshotPage(OFFLINE_URL),
      snapshotPage("/").catch(() => undefined),
    ]),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(KILL_SWITCH ? selfDestruct() : activate());
});

self.addEventListener("fetch", (event) => {
  if (KILL_SWITCH) return;
  const route = classifyRequest(event.request, self.location.origin);
  if (route === "navigation") event.respondWith(handleNavigation(event));
  else if (route === "static") event.respondWith(handleStatic(event));
});

async function activate(): Promise<void> {
  const keep = new Set([SHELL_CACHE, STATIC_CACHE]);
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(CACHE_PREFIX) && !keep.has(key))
      .map((key) => caches.delete(key)),
  );
  await self.registration.navigationPreload?.enable();
  await self.clients.claim();
}

async function selfDestruct(): Promise<void> {
  const keys = await caches.keys();
  await Promise.all(
    keys
      .filter((key) => key.startsWith(CACHE_PREFIX))
      .map((key) => caches.delete(key)),
  );
  await self.registration.unregister();
  // Controlled windows only, so a reloaded tab is never caught again.
  const windows = await self.clients.matchAll({ type: "window" });
  await Promise.allSettled(
    windows.map((client) => client.navigate(client.url)),
  );
}

async function handleNavigation(event: FetchEvent): Promise<Response> {
  const { pathname } = new URL(event.request.url);
  const network = networkNavigation(event);
  const timeout = new Promise<undefined>((resolve) =>
    setTimeout(resolve, NAVIGATION_TIMEOUT_MS),
  );
  const first = await Promise.race([network.catch(() => undefined), timeout]);

  if (first?.ok) {
    if (SHELL_PATH_SET.has(pathname)) {
      event.waitUntil(
        storeSnapshot(pathname, first.clone()).catch(() => undefined),
      );
    }
    return first;
  }
  if (first && first.status < 500) return first; // a 404 is a real answer

  const cached = await matchShell(pathname);
  if (cached) {
    event.waitUntil(
      network
        .then((late) => (late.ok ? storeSnapshot(pathname, late) : undefined))
        .catch(() => undefined),
    );
    return cached;
  }
  const late = first ?? (await network.catch(() => undefined));
  if (late) return late;
  return (await matchShell(OFFLINE_URL)) ?? Response.error();
}

async function networkNavigation(event: FetchEvent): Promise<Response> {
  const preloaded = (await event.preloadResponse) as Response | undefined;
  return preloaded ?? fetch(event.request);
}

async function matchShell(pathname: string): Promise<Response | undefined> {
  if (!SHELL_PATH_SET.has(pathname)) return undefined;
  const shell = await caches.open(SHELL_CACHE);
  return shell.match(pathname, { ignoreSearch: true, ignoreVary: true });
}

async function handleStatic(event: FetchEvent): Promise<Response> {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(event.request);
  if (cached) return cached;
  const response = await fetch(event.request);
  if (isCacheableResponse(response)) {
    event.waitUntil(
      cache
        .put(event.request, response.clone())
        .then(() => trimCache(cache, STATIC_CACHE_MAX_ENTRIES))
        .catch(() => undefined),
    );
  }
  return response;
}

async function snapshotPage(pathname: string): Promise<void> {
  const response = await fetch(pathname, { cache: "no-cache" });
  if (!response.ok) throw new Error(`snapshot ${pathname}: ${response.status}`);
  await storeSnapshot(pathname, response);
}

/**
 * Stores a page only after every chunk it references is cached: a deploy
 * deletes old chunks, and HTML without them renders nothing offline.
 */
async function storeSnapshot(
  pathname: string,
  response: Response,
): Promise<void> {
  if (!isCacheableResponse(response)) return;
  const shell = await caches.open(SHELL_CACHE);
  const etag = response.headers.get("etag");
  const previous = await shell.match(pathname, { ignoreVary: true });
  if (etag && previous?.headers.get("etag") === etag) return;
  const staticCache = await caches.open(STATIC_CACHE);
  // Rejects on any 404: the previous copy is kept.
  await staticCache.addAll(extractStaticAssets(await response.clone().text()));
  await shell.put(pathname, response);
  await trimCache(staticCache, STATIC_CACHE_MAX_ENTRIES);
}

async function trimCache(cache: Cache, maxEntries: number): Promise<void> {
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  if (excess > 0) {
    await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  }
}
