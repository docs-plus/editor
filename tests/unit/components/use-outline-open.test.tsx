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

/** The page frame's verdict, as `PageFrame` passes it (950px in classic). */
let width = 1280;
const isOverlay = () => width < 950;

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
  const [open, set, view] = useOutlineOpen(isOverlay());
  renders.push({ open, set, view });
  return null;
}

let root: Root;

beforeEach(() => {
  localStorage.clear();
  renders.length = 0;
  width = 1280;
  root = createRoot(document.createElement("div"));
});

afterEach(() => {
  act(() => root.unmount());
});

const mount = () => act(() => root.render(createElement(Probe)));
/** The frame crossing its threshold re-renders the shell with the flag. */
function setWidth(next: number) {
  width = next;
  root.render(createElement(Probe));
}

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
