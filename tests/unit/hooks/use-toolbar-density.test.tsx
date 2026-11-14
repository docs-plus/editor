import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";

import { useToolbarDensity } from "@/hooks/use-toolbar-density";
import {
  rememberChoice,
  STORAGE_KEYS,
  TOOLBAR_DENSITY_CHOICE,
  type ToolbarDensity,
} from "@/lib/remembered-choice";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let seen: ToolbarDensity[] = [];

function Probe() {
  seen.push(useToolbarDensity());
  return null;
}

describe("useToolbarDensity", () => {
  let root: Root;
  beforeEach(() => {
    localStorage.clear();
    seen = [];
    root = createRoot(document.createElement("div"));
  });
  afterEach(() => act(() => root.unmount()));

  it("reads the stored value on the first client render (no full-row frame)", () => {
    rememberChoice(TOOLBAR_DENSITY_CHOICE, "simple");
    act(() => root.render(createElement(Probe)));
    expect(seen).toEqual(["simple"]);
  });

  it("renders the full row on the server", () => {
    rememberChoice(TOOLBAR_DENSITY_CHOICE, "simple");
    seen = [];
    renderToString(createElement(Probe));
    expect(seen).toEqual(["full"]);
  });

  it("follows an in-tab write", () => {
    act(() => root.render(createElement(Probe)));
    act(() => rememberChoice(TOOLBAR_DENSITY_CHOICE, "simple"));
    expect(seen.at(-1)).toBe("simple");
  });

  it("follows a write from another tab", () => {
    act(() => root.render(createElement(Probe)));
    localStorage.setItem(
      STORAGE_KEYS.ui,
      JSON.stringify({ v: 1, slots: { toolbarDensity: { last: "simple" } } }),
    );
    act(() => {
      window.dispatchEvent(
        new StorageEvent("storage", { key: STORAGE_KEYS.ui }),
      );
    });
    expect(seen.at(-1)).toBe("simple");
  });

  it("does not re-render when a write leaves the value unchanged", () => {
    act(() => root.render(createElement(Probe)));
    const renders = seen.length;
    act(() => rememberChoice(TOOLBAR_DENSITY_CHOICE, "full"));
    expect(seen.length).toBe(renders);
  });
});
