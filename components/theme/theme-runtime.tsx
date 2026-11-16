"use client";

import { useEffect } from "react";

import { watchSystemTheme } from "@/lib/theme";

/**
 * Follows OS light/dark changes while the theme is System (F3). A leaf in
 * the root layout, so it also runs on `/about`; never in the editor shell.
 */
export function ThemeRuntime(): null {
  useEffect(() => watchSystemTheme(), []);
  return null;
}
