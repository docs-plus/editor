/**
 * Install-prompt store, read through useSyncExternalStore. Chromium fires
 * `beforeinstallprompt` once, often before hydration (the status strip
 * mounts seconds after load), so the inline <body> script captures it on
 * `window.__TINYDOCY_INSTALL_PROMPT` and this module picks it up.
 */

export interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
  prompt(): Promise<void>;
}

declare global {
  interface Window {
    __TINYDOCY_INSTALL_PROMPT?: BeforeInstallPromptEvent;
  }
  interface WindowEventMap {
    beforeinstallprompt: BeforeInstallPromptEvent;
    appinstalled: Event;
  }
}

/** Appended to the inline <body> script in app/layout.tsx. */
export const INSTALL_PROMPT_CAPTURE_SCRIPT =
  'window.addEventListener("beforeinstallprompt",function(e){e.preventDefault();window.__TINYDOCY_INSTALL_PROMPT=e});';

export type InstallAvailability = "none" | "prompt" | "ios";

const INSTALLED_QUERY =
  "(display-mode: standalone), (display-mode: window-controls-overlay)";

let deferred: BeforeInstallPromptEvent | null = null;
let started = false;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function start(): void {
  if (started) return;
  started = true;
  deferred = window.__TINYDOCY_INSTALL_PROMPT ?? null;
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferred = event;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    window.__TINYDOCY_INSTALL_PROMPT = undefined;
    notify();
  });
}

function isInstalled(): boolean {
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return (
    standalone ||
    (typeof window.matchMedia === "function" &&
      window.matchMedia(INSTALLED_QUERY).matches)
  );
}

/** iOS and iPadOS (which reports a Mac user agent with touch). */
function isIos(): boolean {
  const ua = navigator.userAgent;
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
  );
}

export function subscribeInstall(listener: () => void): () => void {
  start();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getInstallAvailability(): InstallAvailability {
  start();
  if (isInstalled()) return "none";
  if (deferred) return "prompt";
  return isIos() ? "ios" : "none";
}

/** Shows the native dialog. The event is single-use, so the button hides. */
export async function promptInstall(): Promise<
  "accepted" | "dismissed" | null
> {
  const event = deferred;
  if (!event) return null;
  deferred = null;
  window.__TINYDOCY_INSTALL_PROMPT = undefined;
  notify();
  await event.prompt();
  return (await event.userChoice).outcome;
}
