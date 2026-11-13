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
 * Whether the engine is installed. If not, asks for it (editors start the
 * load on create, so this usually joins that fetch) and re-renders once it
 * lands. A failed fetch (offline) stays "not ready" until the next mount
 * retries; the E actions keep their loading reason meanwhile.
 */
export function useV11EngineReady(): boolean {
  const [ready, setReady] = useState(() => getV11Engine() !== null);
  useEffect(() => {
    if (ready) return;
    let live = true;
    loadV11Engine().then(
      () => live && setReady(true),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [ready]);
  return ready;
}
