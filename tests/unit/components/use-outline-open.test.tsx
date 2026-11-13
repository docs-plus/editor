import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  type OutlineView,
  type SetOutlineOpen,
  useOutlineOpen,
} from "@/components/toc-sidebar/use-outline-open";
import {
  forgetChoices,
  OUTLINE_OPEN_CHOICE,
  readChoice,
  rememberChoice,
  STORAGE_KEYS,
} from "@/lib/remembered-choice";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A matchMedia stub driven by a fake viewport width. */
let width = 1280;
const queries = new Set<{
  query: string;
  listeners: Set<(event: { matches: boolean }) => void>;
}>();

function matches(query: string): boolean {
  const max = /max-width:\s*(\d+)px/.exec(query);
  if (max) return width <= Number(max[1]);
  const min = /min-width:\s*(\d+)px/.exec(query);
  return min ? width >= Number(min[1]) : false;
}

function setWidth(next: number) {
  width = next;
  for (const entry of queries) {
    for (const listener of entry.listeners) {
      listener({ matches: matches(entry.query) });
    }
  }
}

const originalMatchMedia = window.matchMedia;

interface Seen {
  open: boolean;
  set: SetOutlineOpen;
  view: OutlineView;
}
const renders: Seen[] = [];
const latest = new Proxy({} as Seen, {
  get: (_, key: keyof Seen) => renders.at(-1)?.[key],
});

function Probe() {
  const [open, set, view] = useOutlineOpen();
  renders.push({ open, set, view });
  return null;
}

let root: Root;

beforeEach(() => {
  localStorage.clear();
  renders.length = 0;
  width = 1280;
  queries.clear();
  window.matchMedia = ((query: string) => {
    const entry = {
      query,
      listeners: new Set<(e: { matches: boolean }) => void>(),
    };
    queries.add(entry);
    return {
      get matches() {
        return matches(query);
      },
      media: query,
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) =>
        entry.listeners.add(fn),
      removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) =>
        entry.listeners.delete(fn),
    };
  }) as unknown as typeof window.matchMedia;
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
  window.matchMedia = originalMatchMedia;
});

const mount = () => act(() => root.render(createElement(Probe)));

describe("useOutlineOpen (M6 + overlay)", () => {
  it("docked follows the remembered state", () => {
    rememberChoice(OUTLINE_OPEN_CHOICE, false);
    mount();
    expect(latest.view.mode).toBe("docked");
    expect(latest.open).toBe(false);
  });

  it("docked toggles are remembered", () => {
    mount();
    act(() => latest.set((open) => !open));
    expect(latest.open).toBe(false);
    expect(readChoice(OUTLINE_OPEN_CHOICE).last).toBe(false);
  });

  it("overlay starts closed even when 'open' is remembered", () => {
    rememberChoice(OUTLINE_OPEN_CHOICE, true);
    width = 900;
    mount();
    expect(latest.view.mode).toBe("overlay");
    expect(latest.open).toBe(false);
  });

  it("overlay toggles are not remembered", () => {
    width = 900;
    mount();
    const before = localStorage.getItem(STORAGE_KEYS.ui);
    act(() => latest.set((open) => !open));
    expect(latest.open).toBe(true);
    act(() => latest.view.close());
    expect(latest.open).toBe(false);
    act(() => latest.set(true));
    expect(localStorage.getItem(STORAGE_KEYS.ui)).toBe(before);
  });

  it("crossing 950 resets the overlay and shows the remembered docked state", () => {
    rememberChoice(OUTLINE_OPEN_CHOICE, false);
    width = 900;
    mount();
    act(() => latest.set(true));
    expect(latest.open).toBe(true);
    act(() => setWidth(1200));
    expect(latest.view.mode).toBe("docked");
    expect(latest.open).toBe(false);
    act(() => setWidth(900));
    expect(latest.open).toBe(false);
  });

  it("close() never changes the docked state", () => {
    mount();
    act(() => latest.view.close());
    expect(latest.open).toBe(true);
  });

  it("Forget my choices does not clear the outline state", () => {
    mount();
    act(() => latest.set(false));
    forgetChoices();
    expect(readChoice(OUTLINE_OPEN_CHOICE).last).toBe(false);
  });
});
