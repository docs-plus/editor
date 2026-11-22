import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  createWidthMemo,
  getKeyboardInset,
  KEYBOARD_INSET_VAR,
  keyboardInset,
  onViewportWidthChange,
  subscribeKeyboardInset,
  useKeyboardInset,
  useKeyboardInsetVars,
  VISUAL_VIEWPORT_HEIGHT_VAR,
} from "@/lib/keyboard-inset";

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
const roots: { root: Root; container: HTMLElement }[] = [];
const latest: { current?: number } = {};
const originalViewport = Object.getOwnPropertyDescriptor(
  window,
  "visualViewport",
);
const originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth");

function Harness() {
  const inset = useKeyboardInset();
  useEffect(() => {
    latest.current = inset;
  });
  return null;
}

function VarsOnly() {
  useKeyboardInsetVars();
  return null;
}

/** Runs queued animation frames (happy-dom's rAF is a timer). */
const nextFrame = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));

async function mount(component: () => null = Harness): Promise<Root> {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push({ root, container });
  await act(async () => root.render(createElement(component)));
  return root;
}

const cssVar = (name: string) =>
  document.documentElement.style.getPropertyValue(name);

function setWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: width,
  });
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
  setWidth(390);
  latest.current = undefined;
});

afterEach(async () => {
  for (const { root, container } of roots.splice(0)) {
    await act(async () => root.unmount());
    container.remove();
  }
  if (originalViewport) {
    Object.defineProperty(window, "visualViewport", originalViewport);
  }
  if (originalWidth) Object.defineProperty(window, "innerWidth", originalWidth);
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
    expect(cssVar(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe("800px");
    editable.remove();
    input.remove();
  });

  it("is 0 on the server snapshot path and with no subscriber", () => {
    expect(getKeyboardInset()).toBe(0);
  });
});

describe("the page-wide CSS variables", () => {
  it("are written on <html> while subscribed and removed after", async () => {
    viewport.height = 500;
    const root = await mount();
    expect(cssVar(KEYBOARD_INSET_VAR)).toBe("300px");
    expect(cssVar(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe("500px");
    viewport.height = 600;
    viewport.dispatchEvent(new Event("resize"));
    await nextFrame();
    expect(cssVar(KEYBOARD_INSET_VAR)).toBe("200px");
    expect(cssVar(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe("600px");
    await act(async () => root.unmount());
    expect(cssVar(KEYBOARD_INSET_VAR)).toBe("");
    expect(cssVar(VISUAL_VIEWPORT_HEIGHT_VAR)).toBe("");
    expect(getKeyboardInset()).toBe(0);
  });

  it("are kept live by a CSS-only consumer (a sheet)", async () => {
    viewport.height = 450;
    const root = await mount(VarsOnly);
    expect(cssVar(KEYBOARD_INSET_VAR)).toBe("350px");
    await act(async () => root.unmount());
    expect(cssVar(KEYBOARD_INSET_VAR)).toBe("");
  });

  it("are written at most once per frame", async () => {
    await mount();
    const style = document.documentElement.style;
    const set = style.setProperty.bind(style);
    let writes = 0;
    style.setProperty = (...args: Parameters<typeof style.setProperty>) => {
      writes++;
      set(...args);
    };
    try {
      for (let i = 0; i < 10; i++) {
        viewport.height = 500 - i;
        viewport.dispatchEvent(new Event(i % 2 ? "scroll" : "resize"));
      }
      expect(writes).toBe(0);
      await nextFrame();
      // One frame: the inset and the viewport height, once each.
      expect(writes).toBe(2);
      expect(cssVar(KEYBOARD_INSET_VAR)).toBe("309px");
    } finally {
      style.setProperty = set;
    }
  });
});

describe("one listener set for the whole page", () => {
  it("is shared by every subscriber and removed with the last one", async () => {
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
      const first = await mount();
      const second = await mount(VarsOnly);
      const stopWidth = onViewportWidthChange(() => {});
      expect(viewport.added).toBe(2);
      expect(docAdds.filter((t) => t === "focusout")).toHaveLength(1);
      await act(async () => first.unmount());
      stopWidth();
      expect(viewport.removed).toBe(0);
      await act(async () => second.unmount());
      expect(viewport.removed).toBe(viewport.added);
      expect(docRemoves.filter((t) => t === "focusout")).toEqual(
        docAdds.filter((t) => t === "focusout"),
      );
    } finally {
      document.addEventListener = add;
      document.removeEventListener = remove;
    }
  });

  it("ignores a second call of the same unsubscribe", () => {
    const a = subscribeKeyboardInset(() => {});
    const b = subscribeKeyboardInset(() => {});
    a();
    a();
    expect(viewport.removed).toBe(0);
    b();
    expect(viewport.removed).toBe(2);
  });

  it("adds nothing without a visual viewport", () => {
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: null,
    });
    const stop = subscribeKeyboardInset(() => {});
    expect(getKeyboardInset()).toBe(0);
    expect(cssVar(KEYBOARD_INSET_VAR)).toBe("");
    stop();
  });
});

describe("onViewportWidthChange (orientation change)", () => {
  it("fires once per settled frame when the layout width changes", async () => {
    let calls = 0;
    const stop = onViewportWidthChange(() => calls++);
    try {
      // The keyboard opening resizes the visual viewport only.
      viewport.height = 500;
      viewport.dispatchEvent(new Event("resize"));
      await nextFrame();
      expect(calls).toBe(0);
      // Rotation: the width changes, with several resizes in one frame.
      setWidth(844);
      viewport.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("scroll"));
      viewport.dispatchEvent(new Event("resize"));
      expect(calls).toBe(0);
      await nextFrame();
      expect(calls).toBe(1);
      // Pinch zoom resizes the visual viewport, not the layout width.
      viewport.height = 300;
      viewport.dispatchEvent(new Event("resize"));
      await nextFrame();
      expect(calls).toBe(1);
    } finally {
      stop();
    }
  });
});

describe("the resize settle and the focusout reset share one frame", () => {
  function editable() {
    const el = document.createElement("div");
    el.contentEditable = "true";
    document.body.appendChild(el);
    return el;
  }

  it("a focusout in the same frame as a rotation still reports the width", async () => {
    viewport.height = 500;
    let calls = 0;
    const stopInset = subscribeKeyboardInset(() => {});
    const stop = onViewportWidthChange(() => calls++);
    const el = editable();
    try {
      setWidth(844);
      viewport.dispatchEvent(new Event("resize"));
      el.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
      await nextFrame();
      expect(calls).toBe(1);
      expect(getKeyboardInset()).toBe(0);
      await nextFrame();
      expect(calls).toBe(1);
    } finally {
      stop();
      stopInset();
      el.remove();
    }
  });

  it("a visual viewport scroll in the same frame does not cancel the reset", async () => {
    viewport.height = 500;
    const stop = subscribeKeyboardInset(() => {});
    const el = editable();
    try {
      expect(getKeyboardInset()).toBe(300);
      el.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
      // iOS drift: the viewport stays offset after the keyboard closes.
      viewport.offsetTop = 40;
      viewport.dispatchEvent(new Event("scroll"));
      await nextFrame();
      expect(getKeyboardInset()).toBe(0);
    } finally {
      stop();
      el.remove();
    }
  });

  it("a pending reset does not survive the last unsubscribe", async () => {
    viewport.height = 500;
    const stop = subscribeKeyboardInset(() => {});
    const el = editable();
    el.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
    );
    stop();
    await nextFrame();
    expect(cssVar(KEYBOARD_INSET_VAR)).toBe("");
    const again = subscribeKeyboardInset(() => {});
    try {
      viewport.dispatchEvent(new Event("resize"));
      await nextFrame();
      expect(getKeyboardInset()).toBe(300);
    } finally {
      again();
      el.remove();
    }
  });
});

describe("createWidthMemo (the bar's mount and unmount scroll)", () => {
  it("says nothing moved on the first call or on a same-width remount", () => {
    const moved = createWidthMemo();
    expect(moved()).toBe(false); // first mount
    expect(moved()).toBe(false); // StrictMode cleanup
    expect(moved()).toBe(false); // StrictMode remount, or an editor switch
  });

  it("says the width moved after a rotation across 768 px", () => {
    const moved = createWidthMemo();
    moved(); // the bar mounts in portrait
    setWidth(844);
    expect(moved()).toBe(true); // unmounts in landscape
    setWidth(390);
    expect(moved()).toBe(true); // mounts again in portrait
    expect(moved()).toBe(false);
  });
});
