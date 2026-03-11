"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { MoonStarIcon, SunIcon } from "@/lib/icons";

const THEME_KEY = "tinydocy-theme";

export function ThemeToggle() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    setIsDarkMode(stored === "dark");
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", isDarkMode);
  }, [isDarkMode]);

  const toggleDarkMode = () =>
    setIsDarkMode((prev) => {
      const next = !prev;
      localStorage.setItem(THEME_KEY, next ? "dark" : "light");
      return next;
    });

  return (
    <Button
      onClick={toggleDarkMode}
      aria-label={`Switch to ${isDarkMode ? "light" : "dark"} mode`}
      variant="ghost"
    >
      {isDarkMode ? <MoonStarIcon /> : <SunIcon />}
    </Button>
  );
}
