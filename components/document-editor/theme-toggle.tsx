"use client";

import { useEffect, useState } from "react";

import { ToolbarButton } from "@/components/ui/toolbar-button";
import { MonitorIcon, MoonStarIcon, SunIcon } from "@/lib/icons";
import {
  nextThemePreference,
  readThemePreference,
  setTheme,
  THEME_CHANGE_EVENT,
  type ThemePreference,
} from "@/lib/theme";

const THEME_NAMES: Record<ThemePreference, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

/** What a tap switches to, as the visible label. */
const NEXT_LABELS: Record<ThemePreference, string> = {
  system: "Use system theme",
  light: "Switch to light mode",
  dark: "Switch to dark mode",
};

const THEME_ICONS = {
  system: MonitorIcon,
  light: SunIcon,
  dark: MoonStarIcon,
};

/**
 * The row's theme button flips Light and Dark. With `cycle` (the phone's Aa
 * sheet, which has no ⋯ › Appearance) it steps System → Light → Dark →
 * System: the visible label says what comes next, and the name also says
 * the current theme ("Theme: System, switch to light mode"), so the visible
 * text stays inside the accessible name (WCAG 2.5.3).
 */
export function ThemeToggle({ cycle = false }: { cycle?: boolean }) {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);
  const [preference, setPreference] = useState<ThemePreference>("system");

  // The inline boot script already applied the stored theme: read it back.
  // ⋯ › Appearance, the palette and the OS (while System) also switch it.
  useEffect(() => {
    const read = () => {
      setIsDarkMode(document.documentElement.classList.contains("dark"));
      setPreference(readThemePreference());
    };
    read();
    window.addEventListener(THEME_CHANGE_EVENT, read);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, read);
  }, []);

  if (cycle) {
    const next = nextThemePreference(preference);
    const Icon = THEME_ICONS[preference];
    const label = NEXT_LABELS[next];
    return (
      <ToolbarButton
        onClick={() => setTheme(next)}
        aria-label={`Theme: ${THEME_NAMES[preference]}, ${label.toLowerCase()}`}
        size="sm"
      >
        <Icon aria-hidden="true" />
        <span>{label}</span>
      </ToolbarButton>
    );
  }

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
