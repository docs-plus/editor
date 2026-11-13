import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

import { keyboardInset, useKeyboardInset } from "@/hooks/use-keyboard-inset";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

/** A `visualViewport` double: an EventTarget with writable geometry. */
class FakeViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
  added = 0;
  removed = 0;
  override addEventListener(
    ...args: Parameters<EventTarget["addEventListener"]>
  ) {
    this.added += 1;
    super.addEventListener(...args);
  }
  override removeEventListener(
    ...args: Parameters<EventTarget["removeEventListener"]>
  ) {
    this.removed += 1;
    super.removeEventListener(...args);
  }
}

let viewport: FakeViewport;
let root: Root;
let container: HTMLElement;
const latest: { current?: number } = {};
const original = Object.getOwnPropertyDescriptor(window, "visualViewport");

function Harness() {
  const inset = useKeyboardInset();
  useEffect(() => {
    latest.current = inset;
  });
  return null;
}

/** Runs queued animation frames (happy-dom's rAF is a timer). */
const nextFrame = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness)));
}

beforeEach(() => {
  viewport = new FakeViewport();
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: viewport,
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
  latest.current = undefined;
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  if (original) Object.defineProperty(window, "visualViewport", original);
});

describe("keyboardInset", () => {
  it("is the layout viewport height not covered by the visual viewport", () => {
    expect(keyboardInset(800, { height: 500, offsetTop: 0 })).toBe(300);
    expect(keyboardInset(800, { height: 500, offsetTop: 100 })).toBe(200);
  });

  it("is never negative and rounds to whole pixels", () => {
    expect(keyboardInset(800, { height: 820, offsetTop: 0 })).toBe(0);
    expect(keyboardInset(800, { height: 499.6, offsetTop: 0 })).toBe(300);
  });

  it("is 0 without a visual viewport", () => {
    expect(keyboardInset(800, null)).toBe(0);
  });
});

describe("useKeyboardInset", () => {
  it("reports the keyboard height", async () => {
    await mount();
    expect(latest.current).toBe(0);
    viewport.height = 500;
    viewport.dispatchEvent(new Event("resize"));
    await nextFrame();
    expect(latest.current).toBe(300);
  });

  it("follows visual viewport scrolling", async () => {
    viewport.height = 500;
    await mount();
    expect(latest.current).toBe(300);
    viewport.offsetTop = 120;
    viewport.dispatchEvent(new Event("scroll"));
    await nextFrame();
    expect(latest.current).toBe(180);
  });

  it("resets to 0 after focus leaves editable content (iOS drift)", async () => {
    viewport.height = 500;
    await mount();
    expect(latest.current).toBe(300);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.appendChild(editable);
    // Focus moving between editable fields keeps the keyboard up.
    const input = document.createElement("input");
    document.body.appendChild(input);
    editable.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: input }),
    );
    await nextFrame();
    expect(latest.current).toBe(300);
    // Focus leaving to a button or nowhere: the keyboard is closing.
    editable.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
    );
    await nextFrame();
    expect(latest.current).toBe(0);
    editable.remove();
    input.remove();
  });

  it("removes its listeners on unmount", async () => {
    const docAdds: string[] = [];
    const docRemoves: string[] = [];
    const add = document.addEventListener.bind(document);
    const remove = document.removeEventListener.bind(document);
    document.addEventListener = ((type: string, ...rest: unknown[]) => {
      docAdds.push(type);
      return (add as (...a: unknown[]) => void)(type, ...rest);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((type: string, ...rest: unknown[]) => {
      docRemoves.push(type);
      return (remove as (...a: unknown[]) => void)(type, ...rest);
    }) as typeof document.removeEventListener;
    try {
      await mount();
      expect(viewport.added).toBe(2);
      await act(async () => root.unmount());
      expect(viewport.removed).toBe(viewport.added);
      expect(docRemoves.filter((t) => t === "focusout")).toEqual(
        docAdds.filter((t) => t === "focusout"),
      );
    } finally {
      document.addEventListener = add;
      document.removeEventListener = remove;
    }
  });
});
