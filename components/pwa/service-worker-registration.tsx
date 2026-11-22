"use client";

import { useEffect } from "react";

import { CACHE_PREFIX } from "@/lib/pwa/sw-config";
import { CACHE_LOADED_MESSAGE, loadedStaticPaths } from "@/lib/pwa/sw-routing";

/**
 * Build-time switch, inlined by `bun run build`: NEXT_PUBLIC_SERVICE_WORKER=0
 * unregisters the worker and deletes its caches on the next load. Development
 * never registers, and removes a production worker left on localhost. The
 * desktop renderer never registers either: it is served from disk, and the
 * worker precaches web-only pages (`SHELL_PATHS` has `/privacy`).
 */
export const SERVICE_WORKER_ENABLED =
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PUBLIC_APP_TARGET !== "desktop" &&
  process.env.NEXT_PUBLIC_SERVICE_WORKER !== "0";

const IDLE_TIMEOUT_MS = 10_000;
const IDLE_FALLBACK_MS = 2_000;

async function removeServiceWorker(): Promise<void> {
  const registrations = await navigator.serviceWorker.getRegistrations();
  await Promise.all(registrations.map((r) => r.unregister()));
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(
    keys.filter((k) => k.startsWith(CACHE_PREFIX)).map((k) => caches.delete(k)),
  );
}

function registerServiceWorker(): void {
  // Keep this call literal and unique: Turbopack compiles the worker from
  // this exact shape into /_next/static/service-worker/sw.js.
  navigator.serviceWorker
    .register(new URL("../../lib/pwa/service-worker.ts", import.meta.url), {
      scope: "/",
      updateViaCache: "none",
    })
    .catch(() => undefined);
}

/** Static files among `entries` that did not pass through a service worker. */
function bypassedStaticFiles(entries: PerformanceEntryList): string[] {
  return loadedStaticPaths(
    entries
      .filter((entry) => (entry as PerformanceResourceTiming).workerStart === 0)
      .map(({ name }) => name),
    location.origin,
  );
}

/**
 * A first visit loads its chunks (the editor among them) before the worker
 * controls the page, so they bypass its cache and an offline reload has
 * only the browser's HTTP cache for them. When the worker takes control,
 * this hands it the static files loaded without it, then those that finish
 * later (requested before control, such as the idle surface preload).
 */
export function cacheLoadedFilesOnControl(
  container: ServiceWorkerContainer,
): () => void {
  if (container.controller) return () => undefined;
  let observer: PerformanceObserver | undefined;
  const post = (entries: PerformanceEntryList) => {
    const urls = bypassedStaticFiles(entries);
    if (urls.length === 0) return;
    container.controller?.postMessage({ type: CACHE_LOADED_MESSAGE, urls });
  };
  const onControl = () => {
    post(performance.getEntriesByType("resource"));
    observer = new PerformanceObserver((list) => post(list.getEntries()));
    observer.observe({ type: "resource" });
  };
  container.addEventListener("controllerchange", onControl, { once: true });
  return () => {
    container.removeEventListener("controllerchange", onControl);
    observer?.disconnect();
  };
}

/**
 * Registers after `load` plus idle time, so installing the worker never
 * competes with hydration, the collaboration socket or the editor chunk.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    if (!SERVICE_WORKER_ENABLED) {
      void removeServiceWorker().catch(() => undefined);
      return;
    }
    const stopCaching = cacheLoadedFilesOnControl(navigator.serviceWorker);

    let idleId: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      if ("requestIdleCallback" in window) {
        idleId = window.requestIdleCallback(registerServiceWorker, {
          timeout: IDLE_TIMEOUT_MS,
        });
      } else {
        timer = setTimeout(registerServiceWorker, IDLE_FALLBACK_MS);
      }
    };

    if (document.readyState === "complete") schedule();
    else window.addEventListener("load", schedule, { once: true });

    return () => {
      stopCaching();
      window.removeEventListener("load", schedule);
      if (idleId !== undefined) window.cancelIdleCallback(idleId);
      clearTimeout(timer);
    };
  }, []);

  return null;
}
