/**
 * Spellcheck (#100). macOS and Windows use the OS spellchecker, which
 * downloads nothing. On Linux, Chromium uses Hunspell and fetches the
 * locale's dictionary from Google at startup; even
 * `setSpellCheckerEnabled(false)` alone still started that download on
 * ubuntu-24.04. So Linux keeps spellcheck off until bundled dictionaries
 * are proven offline, with no languages and a closed loopback download URL.
 */
import type { Session } from "electron";

import { diagnostics } from "./diagnostics";

export const spellcheckEnabled = process.platform !== "linux";

export function configureSpellcheck(ses: Session): void {
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
