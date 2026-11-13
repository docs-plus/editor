import { afterEach, describe, expect, it } from "bun:test";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { Toolbar } from "@/components/ui/toolbar";
import { ToolbarButton } from "@/components/ui/toolbar-button";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { root: Root; container: HTMLElement }[] = [];

function mount(showB: boolean, existing?: Root, container?: HTMLElement) {
  const host = container ?? document.createElement("div");
  if (!container) document.body.appendChild(host);
  const root = existing ?? createRoot(host);
  if (!existing) mounted.push({ root, container: host });
  act(() => {
    root.render(
      createElement(
        Toolbar,
        null,
        createElement(ToolbarButton, { "aria-label": "A" }),
        showB ? createElement(ToolbarButton, { "aria-label": "B" }) : null,
        createElement(ToolbarButton, { "aria-label": "C" }),
      ),
    );
  });
  return { root, container: host };
}

const settle = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));

const byLabel = (container: HTMLElement, label: string) =>
  container.querySelector<HTMLElement>(`[aria-label="${label}"]`);

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

describe("Toolbar focus repair", () => {
  it("moves focus to a neighbour when the focused control unmounts", async () => {
    const { root, container } = mount(true);
    await settle();
    byLabel(container, "B")?.focus();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("B");
    mount(false, root, container);
    await settle();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("C");
  });

  it("clamps to the last item when the last control unmounts", async () => {
    const { root, container } = mount(true);
    await settle();
    byLabel(container, "C")?.focus();
    act(() => {
      root.render(
        createElement(
          Toolbar,
          null,
          createElement(ToolbarButton, { "aria-label": "A" }),
          createElement(ToolbarButton, { "aria-label": "B" }),
        ),
      );
    });
    await settle();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("B");
  });

  it("leaves focus alone when the user moved it out of the toolbar", async () => {
    const { root, container } = mount(true);
    const input = document.createElement("input");
    document.body.appendChild(input);
    await settle();
    byLabel(container, "B")?.focus();
    input.focus();
    expect(document.activeElement).toBe(input);
    mount(false, root, container);
    await settle();
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it("does not pull focus back after an arrow press once focus has left", async () => {
    const { root, container } = mount(true);
    const input = document.createElement("input");
    document.body.appendChild(input);
    await settle();
    byLabel(container, "A")?.focus();
    act(() => {
      byLabel(container, "A")?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
      );
    });
    await settle();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("B");
    input.focus();
    // Any later DOM change inside the toolbar re-collects its items.
    mount(false, root, container);
    await settle();
    expect(document.activeElement?.tagName).toBe("INPUT");
    input.remove();
  });

  it("keeps aria-disabled items navigable", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    act(() => {
      root.render(
        createElement(
          Toolbar,
          null,
          createElement(ToolbarButton, { "aria-label": "A" }),
          createElement(ToolbarButton, {
            "aria-label": "B",
            disabled: true,
          }),
          createElement(ToolbarButton, { "aria-label": "C" }),
        ),
      );
    });
    await settle();
    const b = byLabel(container, "B");
    // Focusable when disabled: aria-disabled, never the native attribute.
    expect(b?.getAttribute("aria-disabled")).toBe("true");
    expect(b?.hasAttribute("disabled")).toBe(false);

    const press = async (key: string) => {
      act(() => {
        document.activeElement?.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true }),
        );
      });
      await settle();
      return document.activeElement?.getAttribute("aria-label");
    };
    byLabel(container, "A")?.focus();
    // One press per step: the arrow index follows focus, and the disabled
    // item is a stop of its own.
    expect(await press("ArrowRight")).toBe("B");
    expect(await press("ArrowRight")).toBe("C");
    expect(await press("ArrowLeft")).toBe("B");
  });
});
