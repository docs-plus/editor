"use client";

import { useEffect } from "react";

import { applyPrefs } from "@/lib/prefs/apply";
import { setReadingMode } from "@/lib/prefs/reading-mode";
import { prefsAttributes } from "@/lib/prefs/schema";
import * as store from "@/lib/prefs/store-web";

const apply = () => applyPrefs(prefsAttributes(store.getPrefs()));

declare global {
  interface Window {
    /** Development builds only: e2e drives preferences with no UI yet. */
    __tinydocyPrefs?: typeof store & { setReadingMode: typeof setReadingMode };
  }
}

/**
 * Keeps the `<html>` preference attributes in step with the store: this
 * tab's changes and other tabs' (§5.5). Renders nothing. A leaf in the
 * root layout, never inside the editor shell, so a change re-renders no
 * editor component: CSS variables carry it.
 */
export function PrefsRuntime(): null {
  useEffect(() => {
    apply();
    return store.subscribePrefs(apply);
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    window.__tinydocyPrefs = { ...store, setReadingMode };
    return () => {
      delete window.__tinydocyPrefs;
    };
  }, []);

  return null;
}
