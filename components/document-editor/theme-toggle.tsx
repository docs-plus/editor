"use client";

import { useEffect, useState } from "react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { MoonStarIcon, SunIcon } from "@/lib/icons";
import { applyTheme, THEME_STORAGE_KEY } from "@/lib/theme";

export function ThemeToggle() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  // The inline boot script already applied the stored theme: read it back.
  useEffect(() => {
    setIsDarkMode(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleDarkMode = () => {
    const next = !isDarkMode;
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
