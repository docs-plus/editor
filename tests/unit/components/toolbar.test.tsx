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

describe("Toolbar roving tabindex", () => {
  function mountWith(
    children: React.ReactNode[],
    props: Record<string, unknown> = {},
  ) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    act(() => {
      root.render(createElement(Toolbar, props, ...children));
    });
    return container;
  }
  const button = (label: string, extra: Record<string, unknown> = {}) =>
    createElement(ToolbarButton, { key: label, "aria-label": label, ...extra });
  const tabindexes = (container: HTMLElement, labels: string[]) =>
    labels.map((label) => byLabel(container, label)?.getAttribute("tabindex"));
  const keydown = (key: string) =>
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
      );
    });

  it("makes exactly one item tabbable", async () => {
    const container = mountWith([button("A"), button("B"), button("C")]);
    await settle();
    expect(tabindexes(container, ["A", "B", "C"])).toEqual(["0", "-1", "-1"]);
  });

  it("moves the tab stop with focus and arrows from the focused item", async () => {
    const container = mountWith([button("A"), button("B"), button("C")]);
    await settle();
    // Focus C without an arrow press: the next arrow starts from C.
    act(() => byLabel(container, "C")?.focus());
    expect(tabindexes(container, ["A", "B", "C"])).toEqual(["-1", "-1", "0"]);
    keydown("ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("A");
    keydown("End");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("C");
    keydown("ArrowLeft");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("B");
  });

  it("skips data-roving-skip items", async () => {
    const container = mountWith([
      button("A"),
      button("B", { "data-roving-skip": "" }),
      button("C"),
    ]);
    await settle();
    act(() => byLabel(container, "A")?.focus());
    keydown("ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe("C");
  });

  it("calls onEscape for Esc on an item", async () => {
    let escaped = 0;
    const container = mountWith([button("A")], {
      onEscape: () => {
        escaped += 1;
      },
    });
    await settle();
    act(() => byLabel(container, "A")?.focus());
    keydown("Escape");
    expect(escaped).toBe(1);
  });

  it("takes Esc once, before an item's own handler (a focus tooltip, M3)", async () => {
    let escaped = 0;
    let itemSaw = 0;
    const container = mountWith(
      [
        button("A", {
          onKeyDown: (event: React.KeyboardEvent) => {
            if (event.key !== "Escape") return;
            itemSaw += 1;
            event.stopPropagation();
          },
        }),
        button("B"),
      ],
      {
        onEscape: () => {
          escaped += 1;
        },
      },
    );
    await settle();
    act(() => byLabel(container, "A")?.focus());
    keydown("Escape");
    // One press returns to the editor; the tooltip still sees it and closes.
    expect(escaped).toBe(1);
    expect(itemSaw).toBe(1);
    act(() => byLabel(container, "B")?.focus());
    keydown("Escape");
    expect(escaped).toBe(2);
  });

  it("leaves Esc to an item whose popup is open", async () => {
    let escaped = 0;
    const container = mountWith(
      [button("A", { "aria-expanded": true }), button("B")],
      {
        onEscape: () => {
          escaped += 1;
        },
      },
    );
    await settle();
    act(() => byLabel(container, "A")?.focus());
    keydown("Escape");
    expect(escaped).toBe(0);
  });

  it("ignores keys bubbling from a React portal (an open menu)", async () => {
    const { createPortal } = await import("react-dom");
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    let escaped = 0;
    const portalled = createPortal(
      createElement("button", {
        type: "button",
        "aria-label": "In menu",
        key: "menu",
      }),
      outside,
    );
    mountWith([button("A"), portalled], {
      onEscape: () => {
        escaped += 1;
      },
    });
    await settle();
    const inMenu = outside.querySelector<HTMLElement>("button");
    act(() => inMenu?.focus());
    keydown("Escape");
    keydown("ArrowRight");
    expect(escaped).toBe(0);
    expect(document.activeElement).toBe(inMenu);
    outside.remove();
  });

  it("keeps one tab stop when items mount while focus is elsewhere", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    const render = (labels: string[]) =>
      act(() => {
        root.render(
          createElement(Toolbar, null, ...labels.map((l) => button(l))),
        );
      });
    render(["A", "B"]);
    await settle();
    input.focus();
    render(["A", "X", "Y"]);
    await settle();
    expect(tabindexes(container, ["A", "X", "Y"])).toEqual(["0", "-1", "-1"]);
    input.remove();
  });

  it("keeps one tab stop when a hidden item is shown while focus is elsewhere", async () => {
    const input = document.createElement("input");
    document.body.appendChild(input);
    const container = mountWith([
      button("A"),
      createElement(
        "div",
        { key: "wrap", hidden: true, "data-testid": "wrap" },
        button("B"),
      ),
      button("C"),
    ]);
    await settle();
    input.focus();
    act(() => {
      container
        .querySelector('[data-testid="wrap"]')
        ?.removeAttribute("hidden");
    });
    await settle();
    expect(tabindexes(container, ["A", "B", "C"])).toEqual(["0", "-1", "-1"]);
    input.remove();
  });

  it("focusRovingItem focuses the tab stop", async () => {
    const { focusRovingItem } = await import("@/components/ui/toolbar");
    const container = mountWith([button("A"), button("B")]);
    await settle();
    act(() => byLabel(container, "B")?.focus());
    act(() => (document.activeElement as HTMLElement).blur());
    const toolbar = container.querySelector<HTMLElement>('[role="toolbar"]');
    expect(focusRovingItem(toolbar)).toBe(true);
    expect(document.activeElement?.getAttribute("aria-label")).toBe("B");
  });
});
