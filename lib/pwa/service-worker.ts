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
 * - /_next/static/*: cache-first (content-addressed). A stored stylesheet
 *   also stores the /_next/static files it references (icons, fonts), so
 *   its masks still draw offline. Files a first visit loaded before the
 *   worker controlled it are stored when the page posts them.
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
  CACHE_LOADED_MESSAGE,
  classifyRequest,
  extractCssAssets,
  extractStaticAssets,
  isCacheableResponse,
  loadedStaticPaths,
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

// A first visit loads its chunks (the editor among them) before this worker
// controls the page, so they never pass through handleStatic. The page
// posts what it loaded once controlled (service-worker-registration.tsx).
self.addEventListener("message", (event) => {
  if (KILL_SWITCH || event.data?.type !== CACHE_LOADED_MESSAGE) return;
  const paths = loadedStaticPaths(event.data.urls, self.location.origin);
  if (paths.length > 0) event.waitUntil(cacheLoaded(paths));
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
        .then(() => cacheCssAssets(cache, [event.request.url]))
        .then(() => trimCache(cache, STATIC_CACHE_MAX_ENTRIES))
        .catch(() => undefined),
    );
  }
  return response;
}

/**
 * Stores the files among `paths` the static cache lacks. They come from
 * the browser's HTTP cache, so this costs no network on a warm load. Best
 * effort: a file that fails is fetched again when next requested.
 */
async function cacheLoaded(paths: string[]): Promise<void> {
  const cache = await caches.open(STATIC_CACHE);
  const missing: string[] = [];
  for (const path of paths) {
    if (!(await cache.match(path))) missing.push(path);
  }
  await Promise.allSettled(
    missing.map(async (path) => {
      const response = await fetch(path);
      if (isCacheableResponse(response)) await cache.put(path, response);
    }),
  );
  await cacheCssAssets(cache, missing);
  await trimCache(cache, STATIC_CACHE_MAX_ENTRIES);
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
  const assets = extractStaticAssets(await response.clone().text());
  // Rejects on any 404: the previous copy is kept.
  await staticCache.addAll(assets);
  await cacheCssAssets(staticCache, assets);
  await shell.put(pathname, response);
  await trimCache(staticCache, STATIC_CACHE_MAX_ENTRIES);
}

/**
 * Stores the /_next/static files the cached stylesheets among `urls`
 * reference (CSS icons and fonts load only when first drawn). Best effort:
 * a failed file is fetched again when the page draws it.
 */
async function cacheCssAssets(cache: Cache, urls: string[]): Promise<void> {
  const sheets = urls
    .map((url) => new URL(url, self.location.origin))
    .filter((url) => url.pathname.endsWith(".css"));
  await Promise.allSettled(
    sheets.map(async (sheet) => {
      const css = await (await cache.match(sheet.href))?.text();
      if (!css) return;
      const files = extractCssAssets(css, sheet.href);
      await Promise.allSettled(
        files.map(async (file) => {
          if (!(await cache.match(file))) await cache.add(file);
        }),
      );
    }),
  );
}

async function trimCache(cache: Cache, maxEntries: number): Promise<void> {
  const keys = await cache.keys();
  const excess = keys.length - maxEntries;
  if (excess > 0) {
    await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
  }
}
