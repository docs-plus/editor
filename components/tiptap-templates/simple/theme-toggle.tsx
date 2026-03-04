"use client";

// --- UI Primitives ---
import { Button } from "@/components/tiptap-ui-primitive/button";

// --- Icons ---
import { MoonStarIcon, SunIcon } from "@/components/tiptap-icons";
import { useEffect, useState } from "react";

const THEME_KEY = "tinydocy-theme";

export function ThemeToggle() {
  const [isDarkMode, setIsDarkMode] = useState<boolean>(false);

  useEffect(() => {
    const stored = localStorage.getItem(THEME_KEY);
    if (stored !== null) {
      setIsDarkMode(stored === "dark");
    } else {
      setIsDarkMode(window.matchMedia("(prefers-color-scheme: dark)").matches);
    }
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const handleChange = () => {
      if (localStorage.getItem(THEME_KEY) === null) {
        setIsDarkMode(mediaQuery.matches);
      }
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
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
      {isDarkMode ? (
        <MoonStarIcon className="tiptap-button-icon" />
      ) : (
        <SunIcon className="tiptap-button-icon" />
      )}
    </Button>
  );
}
