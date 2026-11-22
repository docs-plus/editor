import { applyPrefs } from "@/lib/prefs/apply";
import { setReadingMode } from "@/lib/prefs/reading-mode";
import {
  pageProperties,
  prefsAttributes,
  SYSTEM_CONTRAST_QUERY,
} from "@/lib/prefs/schema";
import * as store from "@/lib/prefs/store-web";

/**
 * The preferences runtime (§5.5), a lazy chunk `PageFrame` loads once
 * the page is idle: the first load carries only the boot script's result. It keeps the
 * `<html>` attributes in step with the store (this tab's changes and other
 * tabs') and with the OS contrast setting. Because the boot script and
 * `applyPrefs` produce the same attributes (the parity test), its first
 * apply changes nothing.
 */

declare global {
  interface Window {
    /** Development builds only: e2e drives preferences with no UI yet. */
    __tinydocyPrefs?: typeof store & { setReadingMode: typeof setReadingMode };
  }
}

export function startPrefsRuntime(): () => void {
  const contrast =
    typeof window.matchMedia === "function"
      ? window.matchMedia(SYSTEM_CONTRAST_QUERY)
      : null;
  const apply = () => {
    const prefs = store.getPrefs();
    applyPrefs(
      prefsAttributes(prefs, { systemContrast: contrast?.matches ?? false }),
      pageProperties(prefs.page),
    );
  };
  apply();
  const unsubscribe = store.subscribePrefs(apply);
  contrast?.addEventListener("change", apply);
  if (process.env.NODE_ENV !== "production") {
    window.__tinydocyPrefs = { ...store, setReadingMode };
  }
  return () => {
    unsubscribe();
    contrast?.removeEventListener("change", apply);
    delete window.__tinydocyPrefs;
  };
}
