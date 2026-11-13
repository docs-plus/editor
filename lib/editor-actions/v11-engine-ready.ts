/**
 * Readiness of PR E's lazy engine for the lazy surfaces (selection bubble,
 * phone selection cells). They reach the engine only through
 * `loadV11Engine()` / `getV11Engine()`, never by importing
 * `v11-engine.ts`, so its code lives in exactly one chunk. Kept out of
 * `v11-actions.ts`, which is in the eager editor chunk.
 */
import { useEffect, useState } from "react";

import { getV11Engine, loadV11Engine } from "@/lib/editor-actions/v11-actions";

/**
 * Fired on `window` by `v11-engine.ts` as it installs, whichever load
 * brought it: after a failed fetch, a later one (the pill's Retry) is not
 * the promise a mounted surface waited on.
 */
export const V11_ENGINE_LANDED = "tinydocy:v11-engine";

/**
 * Whether the engine is installed; re-renders when it lands. If it is not,
 * waits on the one load (editors start it on create, so this usually
 * joins that fetch). After a failed fetch (offline) it stays "not ready"
 * until the engine lands from a later load (Retry, another surface).
 */
export function useV11EngineReady(): boolean {
  const [ready, setReady] = useState(() => getV11Engine() !== null);
  useEffect(() => {
    if (ready) return;
    let live = true;
    const landed = () => {
      if (live) setReady(true);
    };
    loadV11Engine().then(landed, () => undefined);
    window.addEventListener(V11_ENGINE_LANDED, landed);
    return () => {
      live = false;
      window.removeEventListener(V11_ENGINE_LANDED, landed);
    };
  }, [ready]);
  return ready;
}
