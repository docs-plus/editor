"use client";

import { WebSocketStatus } from "@hocuspocus/provider";
import { useSyncExternalStore } from "react";

import { getSharedHocuspocusSocket } from "@/lib/hocuspocus";

export type ConnectionState = "online" | "connecting" | "offline";

/** How long the socket may be down (browser online) before the UI says offline. */
const OFFLINE_GRACE_MS = 4000;

/** Retries now instead of waiting out the provider's backoff (up to 30 s). */
export function retryConnection(): void {
  const socket = getSharedHocuspocusSocket();
  if (socket.status === WebSocketStatus.Disconnected) void socket.connect();
}

let current: ConnectionState = "online";
const listeners = new Set<() => void>();
let stopWatching: (() => void) | null = null;

function setState(next: ConnectionState): void {
  if (next === current) return;
  current = next;
  for (const listener of listeners) listener();
}

/**
 * Derives one state from the shared socket and `navigator.onLine`. The
 * socket flips between Connecting and Disconnected on every backoff
 * attempt, so it only reads as offline after a grace period, or at once
 * when the browser itself reports no network.
 */
function watchConnection(): () => void {
  const socket = getSharedHocuspocusSocket();
  let disconnectedSince: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const update = () => {
    clearTimeout(timer);
    if (socket.status === WebSocketStatus.Connected) {
      disconnectedSince = null;
      setState("online");
      return;
    }
    if (!navigator.onLine) {
      setState("offline");
      return;
    }
    disconnectedSince ??= Date.now();
    const remaining = OFFLINE_GRACE_MS - (Date.now() - disconnectedSince);
    if (remaining <= 0) {
      setState("offline");
      return;
    }
    setState("connecting");
    timer = setTimeout(update, remaining);
  };
  const onOnline = () => {
    retryConnection();
    update();
  };

  socket.on("status", update);
  window.addEventListener("online", onOnline);
  window.addEventListener("offline", update);
  update();
  return () => {
    clearTimeout(timer);
    socket.off("status", update);
    window.removeEventListener("online", onOnline);
    window.removeEventListener("offline", update);
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  stopWatching ??= watchConnection();
  return () => {
    listeners.delete(listener);
    if (listeners.size > 0) return;
    stopWatching?.();
    stopWatching = null;
  };
}

const getSnapshot = () => current;
/** Server render and hydration assume online, so markup always matches. */
const getServerSnapshot = (): ConnectionState => "online";

/**
 * Connection to the collab server, shared by every caller so the status
 * strip, offline banner and tab actions always agree. Mount it only inside
 * the editor app: it uses, and may create, the shared socket.
 */
export function useConnectionState(): ConnectionState {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
