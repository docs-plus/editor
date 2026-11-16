import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type ToggleModule = typeof import("@/components/document-editor/theme-toggle");

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const KEY = "tinydocy-theme";
const mounted: { root: Root; container: HTMLElement }[] = [];
let originalMatchMedia: typeof window.matchMedia;

/** The OS reports dark; System must resolve through it. */
function stubOsDark(dark: boolean) {
  window.matchMedia = (() => ({
    matches: dark,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
}

async function render(props: { cycle?: boolean }): Promise<HTMLButtonElement> {
  const { ThemeToggle } = await importFresh<ToggleModule>(
    "@/components/document-editor/theme-toggle",
  );
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(ThemeToggle, props));
  });
  const button = container.querySelector("button");
  if (!button) throw new Error("button not rendered");
  return button;
}

const isDark = () => document.documentElement.classList.contains("dark");

beforeEach(() => {
  localStorage.clear();
  originalMatchMedia = window.matchMedia;
});

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  window.matchMedia = originalMatchMedia;
  document.documentElement.classList.remove("dark");
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    meta.remove();
  }
  localStorage.clear();
  resetModules();
});

describe("ThemeToggle cycle (phone sheet)", () => {
  it("cycles System → Light → Dark → System, naming the current theme", async () => {
    stubOsDark(true);
    localStorage.setItem(KEY, "system");
    document.documentElement.classList.add("dark");
    const button = await render({ cycle: true });

    expect(button.getAttribute("aria-label")).toBe(
      "Theme: System, switch to light mode",
    );
    expect(button.textContent).toBe("Switch to light mode");

    act(() => button.click());
    expect(localStorage.getItem(KEY)).toBe("light");
    expect(isDark()).toBe(false);
    expect(button.getAttribute("aria-label")).toBe(
      "Theme: Light, switch to dark mode",
    );
    expect(button.textContent).toBe("Switch to dark mode");

    act(() => button.click());
    expect(localStorage.getItem(KEY)).toBe("dark");
    expect(isDark()).toBe(true);
    expect(button.getAttribute("aria-label")).toBe(
      "Theme: Dark, use system theme",
    );
    expect(button.textContent).toBe("Use system theme");

    act(() => button.click());
    expect(localStorage.getItem(KEY)).toBe("system");
    // The OS is dark, so System stays dark.
    expect(isDark()).toBe(true);
    expect(button.getAttribute("aria-label")).toBe(
      "Theme: System, switch to light mode",
    );
  });
});

describe("ThemeToggle flip (row)", () => {
  it("still flips Light and Dark only", async () => {
    stubOsDark(false);
    localStorage.setItem(KEY, "system");
    const button = await render({});
    expect(button.getAttribute("aria-label")).toBe("Switch to dark mode");
    act(() => button.click());
    expect(localStorage.getItem(KEY)).toBe("dark");
    act(() => button.click());
    expect(localStorage.getItem(KEY)).toBe("light");
    expect(button.getAttribute("aria-label")).toBe("Switch to dark mode");
  });
});
