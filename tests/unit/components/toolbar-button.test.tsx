import { afterEach, describe, expect, it } from "bun:test";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  ToolbarButton,
  type ToolbarButtonProps,
} from "@/components/ui/toolbar-button";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

function render(props: ToolbarButtonProps): HTMLButtonElement {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(ToolbarButton, props));
  });
  const button = container.querySelector("button");
  if (!button) throw new Error("button not rendered");
  return button;
}

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("ToolbarButton pressed state", () => {
  it("derives aria-pressed and data-active from isActive", () => {
    const button = render({ isActive: true, "aria-label": "Bold" });
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.getAttribute("data-active")).toBe("true");
  });

  it("renders aria-pressed=false when inactive", () => {
    const button = render({ isActive: false, "aria-label": "Bold" });
    expect(button.getAttribute("aria-pressed")).toBe("false");
    expect(button.hasAttribute("data-active")).toBe(false);
  });

  it("leaves aria-pressed off when isActive is undefined", () => {
    const button = render({ "aria-label": "Bold" });
    expect(button.hasAttribute("aria-pressed")).toBe(false);
  });

  it("leaves aria-pressed off menu triggers", () => {
    const button = render({
      isActive: true,
      "aria-haspopup": "menu",
      "aria-label": "List",
    });
    expect(button.hasAttribute("aria-pressed")).toBe(false);
    expect(button.getAttribute("data-active")).toBe("true");
  });

  it("keeps an explicit aria-pressed", () => {
    const button = render({
      isActive: false,
      "aria-pressed": "mixed",
      "aria-label": "B",
    });
    expect(button.getAttribute("aria-pressed")).toBe("mixed");
  });
});
