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

describe("ToolbarButton disabled with a reason", () => {
  it("stays focusable, explains itself and ignores clicks", () => {
    let clicks = 0;
    const button = render({
      disabled: true,
      disabledReason: "Nothing to undo",
      "aria-label": "Undo",
      onClick: () => {
        clicks += 1;
      },
    });
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const describedBy = button.getAttribute("aria-describedby");
    if (!describedBy) throw new Error("aria-describedby missing");
    const reason = document.getElementById(describedBy);
    expect(reason?.textContent).toBe("Nothing to undo");
    expect(reason?.hasAttribute("hidden")).toBe(true);
    button.focus();
    expect(document.activeElement).toBe(button);
    act(() => button.click());
    expect(clicks).toBe(0);
  });

  it("is not described when enabled", () => {
    const button = render({
      disabledReason: "Nothing to undo",
      "aria-label": "Undo",
    });
    expect(button.hasAttribute("aria-describedby")).toBe(false);
    expect(button.getAttribute("aria-disabled")).not.toBe("true");
  });
});

describe("ToolbarButton disabled with a reason and a tooltip", () => {
  it("keeps the reason in aria-describedby through the tooltip trigger", () => {
    const button = render({
      disabled: true,
      disabledReason: "Nothing to undo",
      tooltip: "Undo",
      shortcutKeys: "mod+z",
      "aria-label": "Undo",
    });
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.getAttribute("aria-disabled")).toBe("true");
    const ids = (button.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .filter(Boolean);
    const texts = ids.map((id) => document.getElementById(id)?.textContent);
    expect(texts).toContain("Nothing to undo");
  });

  it("shows the reason, not the label or shortcut, in the tooltip", async () => {
    const button = render({
      disabled: true,
      disabledReason: "Nothing to undo",
      tooltip: "Undo",
      shortcutKeys: "mod+z",
      "aria-label": "Undo",
    });
    await act(async () => {
      button.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
      button.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      button.focus();
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    const popup = document.querySelector('[data-slot="tooltip-content"]');
    expect(popup?.textContent).toContain("Nothing to undo");
    expect(popup?.textContent).not.toContain("Undo​");
    expect(popup?.querySelector("kbd")).toBeNull();
  });
});
