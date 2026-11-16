"use client";

import { useEffect, useState } from "react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { MoonStarIcon, SunIcon } from "@/lib/icons";
import { setTheme, THEME_CHANGE_EVENT } from "@/lib/theme";

export function ThemeToggle() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  // The inline boot script already applied the stored theme: read it back.
  // ⋯ › Appearance, the palette and the OS (while System) also switch it.
  useEffect(() => {
    const read = () =>
      setIsDarkMode(document.documentElement.classList.contains("dark"));
    read();
    window.addEventListener(THEME_CHANGE_EVENT, read);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, read);
  }, []);

  const toggleDarkMode = () => {
    const next = !document.documentElement.classList.contains("dark");
    setTheme(next ? "dark" : "light");
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
