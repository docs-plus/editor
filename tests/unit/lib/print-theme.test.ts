import { afterEach, describe, expect, it } from "bun:test";

import { watchPrintTheme } from "@/lib/print-theme";

const root = () => document.documentElement.classList;

let stop: (() => void) | null = null;

afterEach(() => {
  stop?.();
  stop = null;
  root().remove("dark");
});

describe("watchPrintTheme (details spec E6)", () => {
  it("prints the dark theme light and restores it after", () => {
    root().add("dark");
    stop = watchPrintTheme();
    window.dispatchEvent(new Event("beforeprint"));
    expect(root().contains("dark")).toBe(false);
    window.dispatchEvent(new Event("afterprint"));
    expect(root().contains("dark")).toBe(true);
  });

  it("leaves the light theme light", () => {
    stop = watchPrintTheme();
    window.dispatchEvent(new Event("beforeprint"));
    window.dispatchEvent(new Event("afterprint"));
    expect(root().contains("dark")).toBe(false);
  });

  it("stops listening when unsubscribed", () => {
    root().add("dark");
    watchPrintTheme()();
    window.dispatchEvent(new Event("beforeprint"));
    expect(root().contains("dark")).toBe(true);
  });
});
