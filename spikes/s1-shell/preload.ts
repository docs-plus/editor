/**
 * Sandboxed preload (CJS, no Node). Records whether it can set `<html>`
 * attributes before first paint, counts CSP violations, and bridges menu
 * intents to the page.
 */
import { contextBridge, ipcRenderer } from "electron";

ipcRenderer.send("spike.preloadRan", location.href);
// #106: does a message sent during unload reach main before "closed"?
window.addEventListener("pagehide", () => {
  if (window.top === window) ipcRenderer.send("spike.pagehide", location.href);
});

let htmlAttr: string;
try {
  if (document.documentElement) {
    document.documentElement.dataset.spike = "1";
    htmlAttr = "set";
  } else {
    // No <html> yet: set it the moment the parser inserts it. Mutation
    // observers run at the microtask checkpoint before the first parser
    // script, so this may still beat the boot script.
    htmlAttr = "no-documentElement";
    const observer = new MutationObserver(() => {
      if (!document.documentElement) return;
      document.documentElement.dataset.spike = "1";
      htmlAttr = "no-documentElement;set-via-observer";
      observer.disconnect();
    });
    observer.observe(document, { childList: true });
  }
} catch (error) {
  htmlAttr = `error:${String(error)}`;
}

interface Violation {
  directive: string;
  blocked: string;
  sample: string;
}
const violations: Violation[] = [];
document.addEventListener("securitypolicyviolation", (event) => {
  violations.push({
    directive: event.effectiveDirective,
    blocked: event.blockedURI,
    sample: event.sample.slice(0, 80),
  });
});

if (window.top === window) {
  const observer = new MutationObserver(() => {
    if (document.querySelector('.ProseMirror[contenteditable="true"]')) {
      ipcRenderer.send("spike.mark", "firstEditable");
      observer.disconnect();
    }
  });
  observer.observe(document, { childList: true, subtree: true });
}

const intentListeners = new Set<(intent: string) => void>();
ipcRenderer.on("app.menuIntent", (_event, intent: string) => {
  for (const listener of intentListeners) listener(intent);
});

contextBridge.exposeInMainWorld("tinydocySpike", {
  htmlAttr: () => htmlAttr,
  violations: () => violations.slice(),
  ping: () => ipcRenderer.invoke("spike.ping"),
  onMenuIntent(listener: (intent: string) => void) {
    intentListeners.add(listener);
    return () => intentListeners.delete(listener);
  },
  setHistory: (canUndo: boolean, canRedo: boolean) =>
    ipcRenderer.send("spike.history", canUndo, canRedo),
});

// A frame other than the top one pings main on load: main must refuse it.
if (window.top !== window) {
  window.addEventListener("DOMContentLoaded", () => {
    ipcRenderer.invoke("spike.ping").catch(() => undefined);
  });
}
