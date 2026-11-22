import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { BOOT_SCRIPT } from "@/lib/prefs/boot-script";
import { PREF_ATTRIBUTES } from "@/lib/prefs/schema";
import { THEME_COLOR, THEME_COLOR_DARK } from "@/lib/site-config";
import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type ThemeModule = typeof import("@/lib/theme");

const KEY = "tinydocy-theme";
const CHANGE_EVENT = "tinydocy-theme-change";

/** A `matchMedia` stub whose `matches` and change listeners the test drives. */
function stubColorScheme(initialDark: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const list = {
    matches: initialDark,
    media: "(prefers-color-scheme: dark)",
    addEventListener: (
      _: string,
      listener: (e: { matches: boolean }) => void,
    ) => listeners.add(listener),
    removeEventListener: (
      _: string,
      listener: (e: { matches: boolean }) => void,
    ) => listeners.delete(listener),
  };
  const original = window.matchMedia;
  window.matchMedia = (() => list) as unknown as typeof window.matchMedia;
  return {
    listeners,
    /** Flips the OS scheme and fires the change event, as a browser does. */
    set(dark: boolean) {
      list.matches = dark;
      for (const listener of [...listeners]) listener({ matches: dark });
    },
    restore() {
      window.matchMedia = original;
    },
  };
}

let media: ReturnType<typeof stubColorScheme> | null = null;
const spies: { mockRestore(): void }[] = [];

const runBoot = () => new Function(BOOT_SCRIPT)();
const isDark = () => document.documentElement.classList.contains("dark");
const themeMeta = () =>
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');

function throwingStorage() {
  spies.push(
    spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    }),
    spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    }),
  );
}

beforeEach(() => localStorage.clear());

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  media?.restore();
  media = null;
  document.documentElement.classList.remove("dark");
  // The boot script marks itself done (one applier per load).
  for (const name of PREF_ATTRIBUTES) {
    document.documentElement.removeAttribute(name);
  }
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.remove();
  }
  localStorage.clear();
  resetModules();
});

describe("theme boot script", () => {
  const rows: {
    name: string;
    seed: Record<string, string>;
    osDark: boolean;
    dark: boolean;
    stored: string;
  }[] = [
    {
      name: "new visitor, OS light",
      seed: {},
      osDark: false,
      dark: false,
      stored: "system",
    },
    {
      name: "new visitor, OS dark",
      seed: {},
      osDark: true,
      dark: true,
      stored: "system",
    },
    {
      name: "legacy browser ignores an OS dark",
      seed: { "tinydocy-user": "{}" },
      osDark: true,
      dark: false,
      stored: "light",
    },
    {
      name: "stored dark",
      seed: { [KEY]: "dark" },
      osDark: false,
      dark: true,
      stored: "dark",
    },
    {
      name: "stored system, OS dark",
      seed: { [KEY]: "system" },
      osDark: true,
      dark: true,
      stored: "system",
    },
    {
      name: "invalid stored value reads as missing",
      seed: { [KEY]: "purple" },
      osDark: false,
      dark: false,
      stored: "system",
    },
  ];

  for (const row of rows) {
    it(row.name, () => {
      for (const [key, value] of Object.entries(row.seed)) {
        localStorage.setItem(key, value);
      }
      media = stubColorScheme(row.osDark);
      runBoot();
      expect(isDark()).toBe(row.dark);
      expect(localStorage.getItem(KEY)).toBe(row.stored);
      if (row.dark) expect(themeMeta()?.content).toBe(THEME_COLOR_DARK);
      else expect(themeMeta()).toBeNull();
    });
  }

  it("a new visitor who reloads after tinydocy-user is written still follows the OS", () => {
    media = stubColorScheme(true);
    runBoot();
    document.documentElement.classList.remove("dark");
    document.documentElement.removeAttribute("data-prefs");
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
      meta.remove();
    }
    localStorage.setItem("tinydocy-user", "{}");
    runBoot();
    expect(isDark()).toBe(true);
    expect(localStorage.getItem(KEY)).toBe("system");
  });

  it("follows the OS and never throws when storage is blocked", () => {
    media = stubColorScheme(true);
    throwingStorage();
    expect(runBoot).not.toThrow();
    expect(isDark()).toBe(true);
    expect(themeMeta()?.content).toBe(THEME_COLOR_DARK);
  });
});

describe("theme model", () => {
  it("falls back to light for a returning browser and system otherwise", async () => {
    const theme = await importFresh<ThemeModule>("@/lib/theme");
    expect(theme.fallbackThemePreference(true)).toBe("light");
    expect(theme.fallbackThemePreference(false)).toBe("system");
    expect(theme.THEME_PREFERENCES).toEqual(["system", "light", "dark"]);
    expect(theme.LEGACY_KEY_PREFIX).toBe("tinydocy-");
  });

  it("reads the stored value, else the fallback", async () => {
    const theme = await importFresh<ThemeModule>("@/lib/theme");
    expect(theme.readThemePreference()).toBe("system");
    localStorage.setItem("tinydocy-tabs", "[]");
    expect(theme.readThemePreference()).toBe("light");
    localStorage.setItem(KEY, "dark");
    expect(theme.readThemePreference()).toBe("dark");
    localStorage.setItem(KEY, "purple");
    expect(theme.readThemePreference()).toBe("light");
  });

  it("setTheme('dark') applies, stores and announces once", async () => {
    media = stubColorScheme(false);
    const theme = await importFresh<ThemeModule>("@/lib/theme");
    let events = 0;
    const count = () => events++;
    window.addEventListener(CHANGE_EVENT, count);
    try {
      theme.setTheme("dark");
    } finally {
      window.removeEventListener(CHANGE_EVENT, count);
    }
    expect(isDark()).toBe(true);
    expect(themeMeta()?.content).toBe(THEME_COLOR_DARK);
    expect(localStorage.getItem(KEY)).toBe("dark");
    expect(events).toBe(1);
  });

  it("setTheme('system') resolves through the OS", async () => {
    media = stubColorScheme(true);
    const theme = await importFresh<ThemeModule>("@/lib/theme");
    theme.setTheme("system");
    expect(isDark()).toBe(true);
    media.set(false);
    theme.setTheme("system");
    expect(isDark()).toBe(false);
    expect(themeMeta()?.content).toBe(THEME_COLOR);
  });

  it("setTheme('system') with throwing storage still applies for the session", async () => {
    media = stubColorScheme(true);
    const theme = await importFresh<ThemeModule>("@/lib/theme");
    throwingStorage();
    expect(() => theme.setTheme("system")).not.toThrow();
    expect(isDark()).toBe(true);
    expect(theme.readThemePreference()).toBe("system");
  });

  it("the session choice wins over a later storage write", async () => {
    media = stubColorScheme(false);
    const theme = await importFresh<ThemeModule>("@/lib/theme");
    theme.setTheme("dark");
    localStorage.setItem(KEY, "light");
    expect(theme.readThemePreference()).toBe("dark");
  });
});

describe("watchSystemTheme", () => {
  it("follows OS changes while the preference is system", async () => {
    media = stubColorScheme(false);
    localStorage.setItem(KEY, "system");
    const theme = await importFresh<ThemeModule>("@/lib/theme");
    let events = 0;
    const count = () => events++;
    window.addEventListener(CHANGE_EVENT, count);
    const stop = theme.watchSystemTheme();
    try {
      media.set(true);
      expect(isDark()).toBe(true);
      expect(themeMeta()?.content).toBe(THEME_COLOR_DARK);
      expect(events).toBe(1);
      media.set(false);
      expect(isDark()).toBe(false);
      expect(events).toBe(2);
    } finally {
      stop();
      window.removeEventListener(CHANGE_EVENT, count);
    }
  });

  it("leaves an explicit light choice alone", async () => {
    media = stubColorScheme(false);
    localStorage.setItem(KEY, "light");
    const theme = await importFresh<ThemeModule>("@/lib/theme");
    let events = 0;
    const count = () => events++;
    window.addEventListener(CHANGE_EVENT, count);
    const stop = theme.watchSystemTheme();
    try {
      media.set(true);
      expect(isDark()).toBe(false);
      expect(events).toBe(0);
    } finally {
      stop();
      window.removeEventListener(CHANGE_EVENT, count);
    }
  });

  it("the returned function removes the listener", async () => {
    media = stubColorScheme(false);
    const theme = await importFresh<ThemeModule>("@/lib/theme");
    const stop = theme.watchSystemTheme();
    expect(media.listeners.size).toBe(1);
    stop();
    expect(media.listeners.size).toBe(0);
  });
});

describe("nextThemePreference", () => {
  it("cycles System → Light → Dark → System", async () => {
    const theme = await importFresh<ThemeModule>("@/lib/theme");
    expect(theme.nextThemePreference("system")).toBe("light");
    expect(theme.nextThemePreference("light")).toBe("dark");
    expect(theme.nextThemePreference("dark")).toBe("system");
  });
});
