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

describe("RepeatSplitButton", () => {
  it("renders nothing without a bundle, then names the bundle", () => {
    editor = createTestEditor();
    const el = mount(
      createElement(RepeatSplitButton, { editor: editor as never }),
    );
    expect(el.querySelector("[data-repeat-split]")).toBeNull();
    act(() => rememberBundle({ bold: true, highlight: "yellow" }));
    const face = el.querySelector('[data-action-id="repeat.apply"]');
    expect(face?.getAttribute("aria-label")).toBe(
      "Repeat formatting: Bold, Yellow highlight",
    );
    expect(face?.textContent).toBe("B · Yellow highlight");
    const chevron = el.querySelector('[aria-label="More formatting options"]');
    expect(chevron?.getAttribute("aria-haspopup")).toBe("menu");
  });
});
