/**
 * Readiness of PR E's lazy engine for the lazy surfaces (selection bubble,
 * phone selection cells). They reach the engine only through
 * `loadV11Engine()` / `getV11Engine()`, never by importing
 * `v11-engine.ts`, so its code lives in exactly one chunk. Kept out of
 * `v11-actions.ts`, which is in the eager editor chunk.
 */
import { useEffect, useSyncExternalStore } from "react";

import {
  getV11Engine,
  loadV11Engine,
  subscribeV11Engine,
} from "@/lib/editor-actions/v11-actions";

const isReady = () => getV11Engine() !== null;
const notReady = () => false;

/**
 * Whether the engine is installed; re-renders when it lands. If it is not,
 * asks for it (editors start the load on create, so this usually joins
 * that fetch). A failed fetch (offline) stays "not ready" until the next
 * mount retries; the E actions keep their loading reason meanwhile.
 */
export function useV11EngineReady(): boolean {
  const ready = useSyncExternalStore(subscribeV11Engine, isReady, notReady);
  useEffect(() => {
    if (!ready) loadV11Engine().catch(() => undefined);
  }, [ready]);
  return ready;
}
