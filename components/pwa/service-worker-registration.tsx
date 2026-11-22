"use client";

import { useEffect } from "react";

import { CACHE_PREFIX } from "@/lib/pwa/sw-config";
import { CACHE_LOADED_MESSAGE } from "@/lib/pwa/sw-routing";

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

/**
 * A first visit loads its chunks (the editor among them) before the worker
 * controls the page, so they bypass its cache and an offline reload has
 * only the browser's HTTP cache for them. When the worker takes control,
 * this hands it every file the page loaded; it stores the static ones.
 */
export function cacheLoadedFilesOnControl(
  container: ServiceWorkerContainer,
): () => void {
  if (container.controller) return () => undefined;
  const post = () => {
    container.controller?.postMessage({
      type: CACHE_LOADED_MESSAGE,
      urls: performance.getEntriesByType("resource").map(({ name }) => name),
    });
  };
  container.addEventListener("controllerchange", post, { once: true });
  return () => container.removeEventListener("controllerchange", post);
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
