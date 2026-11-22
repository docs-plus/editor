/**
 * Spellcheck (#100). macOS and Windows use the OS spellchecker, which
 * downloads nothing. On Linux, Chromium uses Hunspell and fetches the
 * locale's dictionary from Google at startup; even
 * `setSpellCheckerEnabled(false)` alone still started that download on
 * ubuntu-24.04. So Linux keeps spellcheck off until bundled dictionaries
 * are proven offline, with no languages and a closed loopback download URL.
 */
import { app, type Session, session } from "electron";

import { diagnostics } from "./diagnostics";

export const spellcheckEnabled = process.platform !== "linux";

const configured = new WeakSet<Session>();

/**
 * SEC-002: applies the guard to every session as Electron creates it, so
 * the default session is covered before any window, request or later
 * session setup can start a dictionary download. Call it in main before
 * `ready` (accessing `session.defaultSession` earlier throws, so it is
 * configured here only if the app is already ready). Idempotent.
 */
export function installSpellcheckGuard(): void {
  app.on("session-created", configureSpellcheck);
  if (app.isReady()) configureSpellcheck(session.defaultSession);
}

export function configureSpellcheck(ses: Session): void {
  if (configured.has(ses)) return;
  configured.add(ses);
  if (!spellcheckEnabled) {
    // #100: disabling spellcheck alone still lets Chromium fetch the
    // locale's Hunspell dictionary from Google (measured on ubuntu-24.04).
    // No languages means no dictionary to fetch, and the download URL is a
    // closed loopback port, so even a request never leaves the machine.
    // Each step on its own, containment first, so one failure can't skip
    // the others; a failure is logged and fails the electron spec.
    const step = (name: string, run: () => void) => {
      try {
        run();
      } catch {
        diagnostics.log("spellcheck_config_failed", { step: name });
      }
    };
    step("download_url", () =>
      ses.setSpellCheckerDictionaryDownloadURL("http://127.0.0.1:9/"),
    );
    step("languages", () => ses.setSpellCheckerLanguages([]));
    step("enabled", () => ses.setSpellCheckerEnabled(false));
  }
  // Evidence for #100.
  ses.on("spellcheck-dictionary-download-begin", () =>
    diagnostics.log("spellcheck_download_begin"),
  );
  ses.on("spellcheck-dictionary-download-success", () =>
    diagnostics.log("spellcheck_download_success"),
  );
}
