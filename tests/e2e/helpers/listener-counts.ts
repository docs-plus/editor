import type { CDPSession } from "@playwright/test";

/**
 * Event listeners on `document` and `window`, counted per target and type
 * (`"document:keydown"`), so a failure names the listener that leaked.
 * Chromium only (DevTools protocol).
 */
export async function listenerCounts(
  cdp: CDPSession,
): Promise<Record<string, number>> {
  const objectGroup = "listener-count";
  const counts: Record<string, number> = {};
  try {
    for (const target of ["document", "window"]) {
      const { result } = await cdp.send("Runtime.evaluate", {
        expression: target,
        objectGroup,
      });
      if (!result.objectId) throw new Error(`no ${target}`);
      const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
        objectId: result.objectId,
      });
      for (const { type } of listeners) {
        const key = `${target}:${type}`;
        counts[key] = (counts[key] ?? 0) + 1;
      }
    }
    return counts;
  } finally {
    await cdp.send("Runtime.releaseObjectGroup", { objectGroup });
  }
}
