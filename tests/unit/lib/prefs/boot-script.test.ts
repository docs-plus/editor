import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";

import {
  BOOT_SCRIPT,
  BOOT_SCRIPT_SHA256,
  buildBootScript,
} from "@/lib/prefs/boot-script";
import {
  type BootStorage,
  PREF_ATTRIBUTES,
  resolveBoot,
  SYSTEM_CONTRAST_QUERY,
} from "@/lib/prefs/schema";
import { THEME_COLOR_DARK } from "@/lib/site-config";

/*
 * Parity (preferences design §5.3): the inline string and `resolveBoot()`
 * must decide the same theme, attributes and writes for every stored
 * payload and media state, so the generated allowlists cannot drift.
 */

const ui = (slots: unknown, v = 1) => JSON.stringify({ v, slots });
const last = (value: unknown) => ({ last: value, recent: [] });

const UI_PAYLOADS: Record<string, string | null> = {
  none: null,
  "default style": ui({ page: last({ style: "default" }) }),
  overrides: ui({
    page: last({
      style: "default",
      size: 20,
      width: "wide",
      spacing: "relaxed",
    }),
  }),
  "full width, smallest size": ui({
    page: last({ style: "default", size: 14, width: "full" }),
  }),
  "bad knobs drop": ui({
    page: last({ style: "default", size: "20", width: "huge", spacing: 3 }),
  }),
  "unknown style reads as missing": ui({ page: last({ style: "comic" }) }),
  "classic is never stored": ui({ page: last({ style: "classic" }) }),
  "a11y and switches": ui({
    a11y: last({ contrast: "more", motion: "reduce" }),
    spellcheck: last(false),
    smartQuotes: last(false),
    rememberPlace: last(false),
  }),
  "invalid a11y and switches": ui({
    a11y: last({ contrast: "max", motion: 1 }),
    spellcheck: last("no"),
    smartQuotes: last(0),
  }),
  "other version": ui({ page: last({ style: "default", size: 32 }) }, 2),
  "not json": "{nope",
  "array slots": JSON.stringify({ v: 1, slots: [] }),
  "entry without last": ui({ page: { recent: [] }, spellcheck: { x: false } }),
  "proto keys": `{"v":1,"slots":{"__proto__":{"last":{"style":"default","size":32}},"smartQuotes":{"last":false}}}`,
  "existing slots kept beside": ui({
    outlineOpen: last(false),
    toolbarDensity: last("simple"),
    page: last({ style: "default", spacing: "compact" }),
  }),
  oversized: ui({
    page: last({ style: "default", size: 24 }),
    pad: "x".repeat(70_000),
  }),
};

const STORAGE_STATES: Record<string, Record<string, string>> = {
  "new visitor": {},
  "F3-era browser (theme only)": { "tinydocy-theme": "system" },
  "pre-F3 returning browser": { "tinydocy-user": "{}" },
  "stored dark, marked new": {
    "tinydocy-theme": "dark",
    "tinydocy-look": "new",
  },
  "marked classic, other keys": {
    "tinydocy-look": "classic",
    "tinydocy-tabs": "[]",
    "unrelated-key": "1",
  },
  "invalid theme and marker": {
    "tinydocy-theme": "purple",
    "tinydocy-look": "retro",
  },
  "only the marker": { "tinydocy-look": "new" },
};

function stubMatchMedia(dark: boolean, contrast = false) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches:
      (dark && query === "(prefers-color-scheme: dark)") ||
      (contrast && query === SYSTEM_CONTRAST_QUERY),
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

function resetDocument() {
  const root = document.documentElement;
  for (const name of PREF_ATTRIBUTES) root.removeAttribute(name);
  root.classList.remove("dark");
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.remove();
  }
}

function snapshot(): BootStorage {
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key !== null) keys.push(key);
  }
  return {
    keys,
    theme: localStorage.getItem("tinydocy-theme"),
    ui: localStorage.getItem("tinydocy-ui"),
    look: localStorage.getItem("tinydocy-look"),
  };
}

function readStorage(): Record<string, string> {
  const all: Record<string, string> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i) as string;
    all[key] = localStorage.getItem(key) as string;
  }
  return all;
}

function readAttributes(): Record<string, string> {
  const root = document.documentElement;
  const attributes: Record<string, string> = {};
  for (const name of PREF_ATTRIBUTES) {
    const value = root.getAttribute(name);
    if (value !== null) attributes[name] = value;
  }
  return attributes;
}

const spies: { mockRestore(): void }[] = [];
let restoreMedia: (() => void) | null = null;

beforeEach(() => {
  localStorage.clear();
  resetDocument();
});

afterEach(() => {
  for (const spy of spies.splice(0)) spy.mockRestore();
  restoreMedia?.();
  restoreMedia = null;
  localStorage.clear();
  resetDocument();
});

describe("boot script parity with resolveBoot()", () => {
  let row = 0;
  for (const [storageName, seed] of Object.entries(STORAGE_STATES)) {
    for (const [uiName, payload] of Object.entries(UI_PAYLOADS)) {
      for (const remember of [true, false]) {
        const systemDark = row % 3 === 0;
        const systemContrast = row++ % 4 === 1;
        it(`${storageName} · ${uiName} · R=${remember ? 1 : 0}${systemDark ? " · OS dark" : ""}${systemContrast ? " · OS contrast" : ""}`, () => {
          for (const [key, value] of Object.entries(seed)) {
            localStorage.setItem(key, value);
          }
          if (payload !== null) localStorage.setItem("tinydocy-ui", payload);
          const before = readStorage();
          const expected = resolveBoot({
            storage: snapshot(),
            remember,
            systemDark,
            systemContrast,
          });
          restoreMedia = stubMatchMedia(systemDark, systemContrast);

          new Function(buildBootScript(remember))();

          expect(readAttributes()).toEqual(
            expected.attributes as Record<string, string>,
          );
          expect(document.documentElement.classList.contains("dark")).toBe(
            expected.dark,
          );
          expect(readStorage()).toEqual({
            ...before,
            ...(expected.writes as Record<string, string>),
          });
          const meta = document.querySelector<HTMLMetaElement>(
            'meta[name="theme-color"]',
          );
          expect(meta?.content ?? null).toBe(
            expected.dark ? THEME_COLOR_DARK : null,
          );
        });
      }
    }
  }

  it("blocked storage: OS theme, today's look, no throw", () => {
    // spyOn misses a Storage method once it has been called (Bun), so the
    // whole global is swapped for one that throws, as a blocked one does.
    const blocked = () => {
      throw new Error("blocked");
    };
    const real = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: blocked,
    });
    spies.push({
      mockRestore: () => {
        if (real) Object.defineProperty(globalThis, "localStorage", real);
      },
    });
    restoreMedia = stubMatchMedia(true);
    const expected = resolveBoot({
      storage: null,
      remember: true,
      systemDark: true,
    });
    expect(() => new Function(BOOT_SCRIPT)()).not.toThrow();
    expect(readAttributes()).toEqual(
      expected.attributes as Record<string, string>,
    );
    expect(expected.prefs.page).toEqual({ style: "classic" });
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("a new visitor who reloads at once keeps the new look", () => {
    restoreMedia = stubMatchMedia(false);
    new Function(BOOT_SCRIPT)();
    expect(document.documentElement.dataset.pageStyle).toBe("default");
    // The editor writes its first keys before the second load.
    localStorage.setItem("tinydocy-user", "{}");
    resetDocument();
    new Function(BOOT_SCRIPT)();
    expect(document.documentElement.dataset.pageStyle).toBe("default");
    expect(localStorage.getItem("tinydocy-look")).toBe("new");
    expect(localStorage.getItem("tinydocy-theme")).toBe("system");
  });

  it("does nothing when a preload already applied the attributes", () => {
    document.documentElement.setAttribute("data-prefs", "1");
    new Function(BOOT_SCRIPT)();
    expect(readAttributes()).toEqual({ "data-prefs": "1" });
    expect(localStorage.length).toBe(0);
  });
});

describe("boot script hash", () => {
  it("is the SHA-256 of the exact inlined string", () => {
    const digest = createHash("sha256")
      .update(BOOT_SCRIPT, "utf8")
      .digest("base64");
    expect(BOOT_SCRIPT_SHA256).toBe(`'sha256-${digest}'`);
  });

  it("stays small enough to inline in every response", () => {
    expect(BOOT_SCRIPT.length).toBeLessThan(2_600);
  });
});
