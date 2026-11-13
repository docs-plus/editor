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

describe("Repeat face availability", () => {
  it("is disabled with the reason on inline code, like the palette", async () => {
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
    act(() => rememberBundle({ bold: true }));
    editor.commands.setTextSelection({ from: 8, to: 13 });
    const el = mount(
      createElement(RepeatSplitButton, { editor: editor as never }),
    );
    const face = () =>
      el.querySelector<HTMLElement>('[data-action-id="repeat.apply"]');
    expect(face()?.hasAttribute("disabled")).toBe(false);
    act(() => {
      editor?.commands.setMark("inlineCode");
    });
    // Doc changes reach the toolbar after the settle window.
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
    const reasonId = face()
      ?.getAttribute("aria-describedby")
      ?.split(" ")
      .find((id) => document.getElementById(id)?.textContent);
    expect(face()?.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(reasonId ?? "")?.textContent).toBe(
      "Code has no formatting.",
    );
  });
});

describe("PhoneSelectionCells Repeat cell, unavailable", () => {
  it("stays tappable and shows its reason on a tap", () => {
    editor = createTestEditor();
    const el = mount(
      createElement(PhoneSelectionCells, {
        editor: editor as never,
        onBack: () => {},
      }),
    );
    const cell = el.querySelector<HTMLButtonElement>(
      '[data-action-id="repeat.apply"]',
    );
    expect(cell?.getAttribute("aria-disabled")).toBe("true");
    act(() => cell?.click());
    expect(el.querySelector("[data-phone-reason]")?.textContent).toBe(
      "Format some text first, or use Copy formatting.",
    );
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
    // The name spells out what it repeats; the compact face is the text.
    expect(face?.getAttribute("aria-label")).toBe(
      "Repeat Bold, Yellow highlight",
    );
    expect(face?.textContent).toContain("B · Yellow highlight");
    // Mod+Alt+V (+ F4 off macOS), like ActionButton.
    expect(face?.getAttribute("aria-keyshortcuts")).toMatch(
      /^(Meta|Control)\+Alt\+v( F4)?$/i,
    );
    const chevron = el.querySelector('[aria-label="Formats"]');
    expect(chevron?.getAttribute("aria-haspopup")).toBe("menu");
  });
});
