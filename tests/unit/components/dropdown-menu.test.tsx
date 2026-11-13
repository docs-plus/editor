import { afterEach, describe, expect, it } from "bun:test";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuReason,
} from "@/components/ui/dropdown-menu";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLElement | undefined;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = undefined;
});

/** An open menu with one disabled item and its visible reason. */
function renderDisabledItem(): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      createElement(
        DropdownMenu,
        { open: true },
        createElement(
          DropdownMenuContent,
          null,
          createElement(
            DropdownMenuItem,
            { disabled: true, "aria-describedby": "why" },
            createElement("span", null, "Table"),
            createElement(
              DropdownMenuReason,
              { id: "why" },
              "Not available in the title.",
            ),
          ),
        ),
      ),
    );
  });
  const item = document.querySelector<HTMLElement>(
    '[data-slot="dropdown-menu-item"]',
  );
  if (!item) throw new Error("item not rendered");
  return item;
}

describe("Dropdown menu disabled reasons (design pass §10)", () => {
  it("shows the reason as a visible second line that describes the item", () => {
    const item = renderDisabledItem();
    const reason = item.querySelector<HTMLElement>(
      '[data-slot="dropdown-menu-reason"]',
    );
    expect(reason?.textContent).toBe("Not available in the title.");
    expect(reason?.hidden).toBe(false);
    expect(reason?.className).toContain("basis-full");
    expect(reason?.className).toContain("text-muted-foreground");
    expect(item.getAttribute("aria-describedby")).toBe("why");
    expect(item.hasAttribute("data-disabled")).toBe(true);
  });

  it("dims every part of a disabled item but its reason, never the item", () => {
    const item = renderDisabledItem();
    const classes = item.className.split(/\s+/);
    expect(classes).not.toContain("data-disabled:opacity-50");
    expect(classes).toContain(
      "data-disabled:*:not-data-[slot=dropdown-menu-reason]:opacity-50",
    );
    expect(classes).toContain("flex-wrap");
  });
});
