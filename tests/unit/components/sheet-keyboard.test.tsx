import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { KEYBOARD_INSET_VAR } from "@/lib/keyboard-inset";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement | undefined;
const original = Object.getOwnPropertyDescriptor(window, "visualViewport");

class FakeViewport extends EventTarget {
  height = 500;
  offsetTop = 0;
}

beforeEach(() => {
  Object.defineProperty(window, "visualViewport", {
    configurable: true,
    value: new FakeViewport(),
  });
  Object.defineProperty(window, "innerHeight", {
    configurable: true,
    value: 800,
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
  if (original) Object.defineProperty(window, "visualViewport", original);
});

function render(
  open: boolean,
  content: Parameters<typeof SheetContent>[0] = {},
) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  act(() => {
    root?.render(
      createElement(
        Sheet,
        { open },
        createElement(
          SheetContent,
          content,
          createElement(SheetTitle, null, "Rename"),
          createElement("input", { "aria-label": "Name" }),
        ),
      ),
    );
  });
}

const popup = () =>
  document.querySelector<HTMLElement>('[data-slot="sheet-content"]');

describe("a bottom sheet and the on-screen keyboard (§4.6)", () => {
  it("sits on the keyboard inset and fits the visual viewport", () => {
    render(true);
    const classes = popup()?.className ?? "";
    expect(classes).toContain("bottom-[var(--keyboard-inset,0px)]");
    expect(classes).toContain(
      "max-h-[min(var(--sheet-max-h,85dvh),var(--visual-viewport-height,var(--sheet-max-h,85dvh)))]",
    );
    expect(classes).not.toMatch(/(^|\s)bottom-0(\s|$)/);
  });

  it("keeps --keyboard-inset live only while it is open", () => {
    render(false);
    expect(
      document.documentElement.style.getPropertyValue(KEYBOARD_INSET_VAR),
    ).toBe("");
    render(true);
    expect(
      document.documentElement.style.getPropertyValue(KEYBOARD_INSET_VAR),
    ).toBe("300px");
    act(() => root?.unmount());
    root = undefined;
    expect(
      document.documentElement.style.getPropertyValue(KEYBOARD_INSET_VAR),
    ).toBe("");
  });

  it("composes a caller's height cap with the visual viewport cap", () => {
    render(true, { className: "[--sheet-max-h:60dvh]" });
    const classes = popup()?.className ?? "";
    expect(classes).toContain(
      "max-h-[min(var(--sheet-max-h,85dvh),var(--visual-viewport-height,var(--sheet-max-h,85dvh)))]",
    );
    expect(classes).toContain("[--sheet-max-h:60dvh]");
  });
});

describe("a sheet without a field stays off the keyboard (the Aa sheet)", () => {
  it("sits on the screen bottom with its own cap and no visual viewport cap", () => {
    render(true, { keyboard: false, className: "max-h-[60dvh]" });
    const classes = popup()?.className ?? "";
    expect(classes).toMatch(/(^|\s)bottom-0(\s|$)/);
    expect(classes).toContain("max-h-[60dvh]");
    expect(classes).not.toContain("--keyboard-inset");
    expect(classes).not.toContain("--visual-viewport-height");
  });

  it("does not keep --keyboard-inset live on its own", () => {
    render(true, { keyboard: false });
    expect(
      document.documentElement.style.getPropertyValue(KEYBOARD_INSET_VAR),
    ).toBe("");
  });
});
