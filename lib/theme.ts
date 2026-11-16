import { THEME_COLOR, THEME_COLOR_DARK } from "@/lib/site-config";

export const THEME_STORAGE_KEY = "tinydocy-theme";

/** Fired on `window` after the theme changes, so controls re-read it. */
export const THEME_CHANGE_EVENT = "tinydocy-theme-change";

/**
 * Our own theme-color meta, placed before the one Next renders from
 * `viewport.themeColor`. Browsers use the first match, and React never
 * touches this element: rewriting React's meta before hydration makes
 * React 19 insert a second, light one.
 */
export const THEME_COLOR_META_ID = "tinydocy-theme-color";

export type ThemePreference = "system" | "light" | "dark";

export const THEME_PREFERENCES: readonly ThemePreference[] = [
  "system",
  "light",
  "dark",
];

/**
 * Any localStorage key with this prefix, other than the theme key, marks a
 * browser that used TinyDocy before System existed (preferences spec §5.6).
 */
export const LEGACY_KEY_PREFIX = "tinydocy-";

export const SYSTEM_DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * The choice made in this tab. It wins over storage until reload, so a
 * blocked or concurrently rewritten storage never undoes the last pick.
 */
let sessionPreference: ThemePreference | null = null;

function isThemePreference(value: unknown): value is ThemePreference {
  return THEME_PREFERENCES.includes(value as ThemePreference);
}

/** §5.6: a returning browser keeps today's Light; a new one follows the OS. */
export function fallbackThemePreference(
  hasLegacyKey: boolean,
): ThemePreference {
  return hasLegacyKey ? "light" : "system";
}

function hasLegacyKey(storage: Storage): boolean {
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (key !== THEME_STORAGE_KEY && key?.startsWith(LEGACY_KEY_PREFIX)) {
      return true;
    }
  }
  return false;
}

/** The session choice, then the stored valid value, then the fallback. */
export function readThemePreference(): ThemePreference {
  if (sessionPreference) return sessionPreference;
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (isThemePreference(stored)) return stored;
    return fallbackThemePreference(hasLegacyKey(localStorage));
  } catch {
    // Blocked storage: the boot script followed the OS, so do the same.
    return "system";
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window.matchMedia === "function" &&
    window.matchMedia(SYSTEM_DARK_QUERY).matches
  );
}

function themeColorMeta(): HTMLMetaElement {
  const existing = document.getElementById(THEME_COLOR_META_ID);
  if (existing instanceof HTMLMetaElement) return existing;
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.id = THEME_COLOR_META_ID;
  document.head.prepend(meta);
  return meta;
}

/**
 * Toggles the class theme and the title-bar colour (installed windows,
 * Android and Safari browser chrome). The theme is a class toggle, so a
 * `prefers-color-scheme` theme-color would be wrong when the user overrides
 * the OS.
 */
export function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  themeColorMeta().content = dark ? THEME_COLOR_DARK : THEME_COLOR;
}

function announceThemeChange(): void {
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/** The only writer of the theme: stores, applies and announces it. */
export function setTheme(preference: ThemePreference): void {
  sessionPreference = preference;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Private mode: the choice lasts for this tab only.
  }
  applyTheme(
    preference === "system" ? systemPrefersDark() : preference === "dark",
  );
  announceThemeChange();
}

/**
 * Follows OS colour-scheme changes while the preference is System. Mounted
 * once per page (`ThemeRuntime`); returns the unsubscribe.
 */
export function watchSystemTheme(): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const list = window.matchMedia(SYSTEM_DARK_QUERY);
  const onChange = (event: { matches: boolean }) => {
    if (readThemePreference() !== "system") return;
    applyTheme(event.matches);
    announceThemeChange();
  };
  list.addEventListener("change", onChange);
  return () => list.removeEventListener("change", onChange);
}
