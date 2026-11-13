import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  nextMobileBarMode,
  PhoneSelectionCells,
} from "@/components/smart-toolbar/phone-selection-cells";
import { RepeatSplitButton } from "@/components/smart-toolbar/repeat-split-button";
import {
  rememberBundle,
  resetBundleMemoryForTests,
} from "@/extensions/repeat-formatting/bundle-memory";
// The surfaces no longer import the engine; install it as an editor would.
import "@/lib/editor-actions/v11-engine";

import { createTestEditor } from "../../helpers/create-test-editor";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;
let editor: Editor | null = null;

function mount(element: ReturnType<typeof createElement>): HTMLElement {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root?.render(element));
  return container;
}

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  editor?.destroy();
  root = null;
  container = null;
  editor = null;
  resetBundleMemoryForTests();
});

describe("nextMobileBarMode", () => {
  it.each([
    [
      {
        hasTextSelection: true,
        focusInBar: false,
        dismissedForSelection: false,
        current: "all",
      },
      "selection",
    ],
    [
      {
        hasTextSelection: true,
        focusInBar: true,
        dismissedForSelection: false,
        current: "all",
      },
      "all",
    ],
    [
      {
        hasTextSelection: false,
        focusInBar: true,
        dismissedForSelection: false,
        current: "selection",
      },
      "selection",
    ],
    [
      {
        hasTextSelection: false,
        focusInBar: false,
        dismissedForSelection: false,
        current: "selection",
      },
      "all",
    ],
    [
      {
        hasTextSelection: true,
        focusInBar: false,
        dismissedForSelection: true,
        current: "all",
      },
      "all",
    ],
    // ✕ pressed with keyboard or VoiceOver focus in the bar: an explicit
    // Back overrides the focus guard.
    [
      {
        hasTextSelection: true,
        focusInBar: true,
        dismissedForSelection: true,
        current: "selection",
      },
      "all",
    ],
  ] as const)("%o → %s", (input, expected) => {
    expect(nextMobileBarMode(input)).toBe(expected);
  });
});

describe("PhoneSelectionCells", () => {
  it("always offers Back to all tools and calls onBack", () => {
    editor = createTestEditor();
    let backs = 0;
    const el = mount(
      createElement(PhoneSelectionCells, {
        editor: editor as never,
        onBack: () => {
          backs += 1;
        },
      }),
    );
    const back = el.querySelector<HTMLButtonElement>(
      '[aria-label="Back to all tools"]',
    );
    expect(back).not.toBeNull();
    act(() => back?.click());
    expect(backs).toBe(1);
    // repeat.apply is registered (E); D1/D2 ids render once they land.
    expect(el.querySelector('[data-action-id="repeat.apply"]')).not.toBeNull();
  });
});

describe("PhoneSelectionCells Repeat cell", () => {
  it("enables as soon as a bundle is remembered, without a selection change", () => {
    editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          {
            type: "paragraph",
            content: [{ type: "text", text: "hello world" }],
          },
        ],
      },
    });
    editor.commands.setTextSelection({ from: 8, to: 13 });
    const el = mount(
      createElement(PhoneSelectionCells, {
        editor: editor as never,
        onBack: () => {},
      }),
    );
    const cell = () =>
      el.querySelector<HTMLButtonElement>('[data-action-id="repeat.apply"]');
    expect(cell()?.getAttribute("aria-disabled")).toBe("true");
    act(() => rememberBundle({ bold: true }));
    expect(cell()?.getAttribute("aria-disabled")).not.toBe("true");
  });
});

describe("PhoneSelectionCells Back", () => {
  it("moves focus to the bar's first cell once the cells unmount", async () => {
    editor = createTestEditor();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    const bar = (cells: boolean) =>
      createElement(
        "div",
        { role: "toolbar", "aria-label": "Formatting" },
        cells
          ? createElement(PhoneSelectionCells, {
              editor: editor as never,
              onBack: () => act(() => root?.render(bar(false))),
            })
          : createElement("button", { type: "button", id: "aa" }, "Aa"),
      );
    act(() => root?.render(bar(true)));
    const back = container.querySelector<HTMLButtonElement>(
      '[aria-label="Back to all tools"]',
    );
    back?.focus();
    act(() => back?.click());
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(document.activeElement?.id).toBe("aa");
  });
});

describe("RepeatSplitButton", () => {
  it("renders nothing without a bundle, then names the bundle", () => {
    editor = createTestEditor();
    const el = mount(
      createElement(RepeatSplitButton, { editor: editor as never }),
    );
    expect(el.querySelector("[data-repeat-split]")).toBeNull();
    act(() => rememberBundle({ bold: true, highlight: "yellow" }));
    const face = el.querySelector('[data-action-id="repeat.apply"]');
    // Label in Name (WCAG 2.5.3): the name starts with the visible face.
    expect(face?.getAttribute("aria-label")).toBe(
      "Repeat B · Yellow highlight",
    );
    const description = el.querySelector(
      `[id="${face?.getAttribute("aria-describedby")}"]`,
    );
    expect(description?.textContent).toBe("Bold, Yellow highlight");
    expect(face?.textContent).toContain("B · Yellow highlight");
    const chevron = el.querySelector('[aria-label="Formats"]');
    expect(chevron?.getAttribute("aria-haspopup")).toBe("menu");
  });
});
