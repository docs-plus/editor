"use client";

import { useEffect } from "react";

import { watchPrintTheme } from "@/lib/print-theme";
import { watchSystemTheme } from "@/lib/theme";

/**
 * Follows OS light/dark changes while the theme is System (F3), and prints
 * in the light theme (E6). A leaf in the root layout, so it also runs on
 * `/about`; never in the editor shell.
 */
export function ThemeRuntime(): null {
  useEffect(() => watchSystemTheme(), []);
  useEffect(() => watchPrintTheme(), []);
  return null;
}
