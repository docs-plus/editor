import { afterEach, describe, expect, it } from "bun:test";

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import { TableSizeGrid } from "@/components/smart-toolbar/insert/table-size-grid";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
const originalMatchMedia = window.matchMedia;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  window.matchMedia = originalMatchMedia;
});

function mount() {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      createElement(TableSizeGrid, {
        initial: { rows: 8, cols: 8 },
        onPick: () => {},
      }),
    );
  });
  return host;
}

const cell = (container: HTMLElement, row: number, col: number) =>
  container.querySelector<HTMLElement>(
    `[data-row="${row}"][data-col="${col}"]`,
  );

describe("TableSizeGrid", () => {
  it("previews on hover without moving focus; arrows move focus", () => {
    const container = mount();
    const opening = cell(container, 8, 8);
    expect(document.activeElement).toBe(opening);

    act(() => {
      cell(container, 2, 3)?.dispatchEvent(
        new PointerEvent("pointerover", { bubbles: true }),
      );
    });
    expect(cell(container, 2, 3)?.dataset.inRange).toBe("true");
    expect(cell(container, 3, 3)?.dataset.inRange).toBe("false");
    expect(document.activeElement).toBe(opening);

    act(() => {
      opening?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(cell(container, 2, 2));
  });

  it("caps the grid at 6 × 6 on a coarse pointer", () => {
    window.matchMedia = ((query: string) => ({
      ...originalMatchMedia.call(window, query),
      matches: query === "(pointer: coarse)",
    })) as typeof window.matchMedia;
    const container = mount();
    expect(container.querySelectorAll(".st-table-cell")).toHaveLength(36);
    // The remembered 8 × 8 is clamped to the largest size shown.
    expect(document.activeElement).toBe(cell(container, 6, 6));
  });
});
