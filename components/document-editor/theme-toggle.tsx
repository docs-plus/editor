"use client";

import { useEffect, useState } from "react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { MoonStarIcon, SunIcon } from "@/lib/icons";
import { applyTheme, THEME_CHANGE_EVENT, THEME_STORAGE_KEY } from "@/lib/theme";

export function ThemeToggle() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  // The inline boot script already applied the stored theme: read it back.
  // ⋯ can also switch it while this button is collapsed (spec §4.6 T2).
  useEffect(() => {
    const read = () =>
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    read();
    window.addEventListener(THEME_CHANGE_EVENT, read);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, read);
  }, []);

  const toggleDarkMode = () => {
    const next = !document.documentElement.classList.contains("dark");
    applyTheme(next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next ? "dark" : "light");
    } catch {
      // Private mode: the choice lasts for this page only.
    }
    setIsDarkMode(next);
  };

  return (
    <ToolbarButton
      onClick={toggleDarkMode}
      aria-label={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
      tooltip={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
    >
      {isDarkMode ? <MoonStarIcon /> : <SunIcon />}
    </ToolbarButton>
  );
}
