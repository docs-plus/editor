import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { lazySurface } from "@/components/smart-toolbar/lazy-surface";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const Text = ({ text }: { text: string }) => createElement("span", null, text);

/** A loader that fails `failures` times, then loads `Text`; counts calls. */
function flakyLoader(failures: number) {
  const loader = {
    calls: 0,
    load: () => {
      loader.calls += 1;
      return loader.calls <= failures
        ? Promise.reject(new Error("ChunkLoadError"))
        : Promise.resolve(Text);
    },
  };
  return loader;
}

/** Lets rejected and resolved loads settle and React retry. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  });

const HINT = "Couldn’t load colours.Retry";

describe("lazySurface", () => {
  let host: HTMLDivElement;
  let root: Root;
  let consoleError: ReturnType<typeof spyOn>;

  beforeEach(() => {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    // React reports every error a boundary catches.
    consoleError = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    consoleError.mockRestore();
  });

  type Surface = ReturnType<typeof lazySurface<{ text: string }>>;
  const surface = (load: () => Promise<typeof Text>) =>
    lazySurface(load, "loading", "colours");
  function mount(Surface: Surface) {
    act(() => root.render(createElement(Surface, { text: "loaded" })));
  }

  it("renders the surface once its chunk loads", async () => {
    const loader = flakyLoader(0);
    mount(surface(loader.load));
    expect(host.textContent).toBe("loading");
    await settle();
    expect(host.textContent).toBe("loaded");
  });

  it("renders only the failure hint when the chunk fails, without refetching in a loop", async () => {
    const loader = flakyLoader(Number.POSITIVE_INFINITY);
    mount(surface(loader.load));
    await settle();
    // Names the surface, with an icon and Retry (design pass §12).
    const hint = host.querySelector('[role="status"]');
    expect(hint?.textContent).toBe(HINT);
    expect(hint?.querySelector("svg")).not.toBeNull();
    expect(host.textContent).toBe(HINT);
    expect(loader.calls).toBe(1);
  });

  it("fetches the chunk again on the next mount after a failure", async () => {
    const loader = flakyLoader(1);
    const Surface = surface(loader.load);
    mount(Surface);
    await settle();
    expect(host.textContent).toBe(HINT);

    act(() => root.render(null));
    mount(Surface);
    await settle();
    expect(loader.calls).toBe(2);
    expect(host.textContent).toBe("loaded");
  });

  it("Retry resets the boundary and fetches the chunk again", async () => {
    const loader = flakyLoader(1);
    mount(surface(loader.load));
    await settle();
    expect(host.textContent).toBe(HINT);
    const retry = host.querySelector("button");
    expect(retry?.textContent).toBe("Retry");
    act(() => retry?.click());
    await settle();
    expect(loader.calls).toBe(2);
    expect(host.textContent).toBe("loaded");
  });

  it("shows the fallback, not a hint, for a surface without a name", async () => {
    const loader = flakyLoader(Number.POSITIVE_INFINITY);
    const Surface = lazySurface(loader.load, "plain");
    act(() => root.render(createElement(Surface, { text: "loaded" })));
    await settle();
    expect(host.textContent).toBe("plain");
    expect(host.querySelector('[role="status"]')).toBeNull();
  });

  it("names the surface from its props", async () => {
    const loader = flakyLoader(Number.POSITIVE_INFINITY);
    const Surface = lazySurface(
      loader.load,
      undefined,
      ({ text }: { text: string }) => `the ${text}`,
    );
    act(() => root.render(createElement(Surface, { text: "table picker" })));
    await settle();
    expect(host.textContent).toBe("Couldn’t load the table picker.Retry");
  });
});
