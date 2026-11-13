import { afterEach, describe, expect, it } from "bun:test";

import type { Editor } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  nextMobileBarMode,
  PhoneSelectionCells,
} from "@/components/smart-toolbar/phone-selection-cells";
import {
  besideBubble,
  StatusPill,
} from "@/components/smart-toolbar/status-pill";
import { RepeatFormatting } from "@/extensions/repeat-formatting";
import {
  getRememberedBundle,
  rememberBundle,
  resetBundleMemoryForTests,
} from "@/extensions/repeat-formatting/bundle-memory";
import { announce, dismissNotice, getNotice } from "@/lib/announce";
// The surfaces never import the engine; install it as an editor would.
import { v11Engine } from "@/lib/editor-actions/v11-engine";

import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";

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
  dismissNotice();
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
  it("renders the eight cells in order and calls onBack", () => {
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
    // Colour cells are named for the remembered colour: drop it here.
    const names = Array.from(el.querySelectorAll("button"), (button) =>
      button.getAttribute("aria-label")?.replace(/:.*/, ""),
    );
    expect(names).toEqual([
      "Bold",
      "Italic",
      "Underline",
      "Apply text colour",
      "Apply highlight",
      "Link",
      "Paint format",
      "Back to all tools",
    ]);
    // No Repeat or Formats cell, no scroller (design pass §6).
    expect(el.querySelector('[data-action-id="repeat.apply"]')).toBeNull();
    expect(el.querySelector('[aria-label="Formats"]')).toBeNull();
    expect(el.querySelector("[data-phone-selection-cells]")).toBeNull();
    const back = el.querySelector<HTMLButtonElement>(
      '[aria-label="Back to all tools"]',
    );
    act(() => back?.click());
    expect(backs).toBe(1);
  });
});

describe("Paint format brush", () => {
  const doc = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "Title" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "hello", marks: [{ type: "bold" }] },
          { type: "text", text: " world" },
        ],
      },
    ],
  };

  it("arms (pressed) and a second press cancels, leaving Repeat as it was", () => {
    editor = createTestEditor({
      content: doc,
      extensions: [...DEFAULT_EXTENSIONS, RepeatFormatting],
    });
    editor.commands.setTextSelection({ from: 8, to: 13 });
    const el = mount(
      createElement(PhoneSelectionCells, {
        editor: editor as never,
        onBack: () => {},
      }),
    );
    const brush = () =>
      el.querySelector<HTMLButtonElement>('[aria-label="Paint format"]');
    expect(brush()?.getAttribute("aria-pressed")).toBe("false");
    act(() => brush()?.click());
    expect(brush()?.getAttribute("aria-pressed")).toBe("true");
    expect(getNotice()?.text).toBe("Select text to paint · Esc to cancel");
    // Same selection again: cancels without applying.
    act(() => brush()?.click());
    expect(brush()?.getAttribute("aria-pressed")).toBe("false");
    // Picked up but never applied: not the Repeat bundle.
    expect(getRememberedBundle()).toBeNull();
  });

  it("arming on plain text and cancelling keeps the Repeat bundle", () => {
    editor = createTestEditor({
      content: doc,
      extensions: [...DEFAULT_EXTENSIONS, RepeatFormatting],
    });
    rememberBundle({ italic: true });
    editor.commands.setTextSelection({ from: 14, to: 19 });
    const el = mount(
      createElement(PhoneSelectionCells, {
        editor: editor as never,
        onBack: () => {},
      }),
    );
    const brush = () =>
      el.querySelector<HTMLButtonElement>('[aria-label="Paint format"]');
    act(() => brush()?.click());
    expect(brush()?.getAttribute("aria-pressed")).toBe("true");
    act(() => brush()?.click());
    expect(getRememberedBundle()).toEqual({ italic: true });
  });

  it("applies to a new selection on the second press, as one step", () => {
    editor = createTestEditor({
      content: doc,
      extensions: [...DEFAULT_EXTENSIONS, RepeatFormatting],
    });
    editor.commands.setTextSelection({ from: 8, to: 13 });
    const el = mount(
      createElement(PhoneSelectionCells, {
        editor: editor as never,
        onBack: () => {},
      }),
    );
    const brush = () =>
      el.querySelector<HTMLButtonElement>('[aria-label="Paint format"]');
    act(() => brush()?.click());
    act(() => {
      editor?.commands.setTextSelection({ from: 14, to: 19 });
    });
    act(() => brush()?.click());
    expect(brush()?.getAttribute("aria-pressed")).toBe("false");
    expect(editor.state.doc.textBetween(14, 19)).toBe("world");
    expect(editor.isActive("bold")).toBe(true);
    expect(getNotice()).toMatchObject({
      text: "Formatting applied",
      done: true,
    });
    // Applied: now it is the Repeat bundle.
    expect(getRememberedBundle()).toMatchObject({ bold: true });
  });

  it("is disabled with the reason on inline code, unless armed", async () => {
    editor = createTestEditor({
      content: doc,
      extensions: [...DEFAULT_EXTENSIONS, RepeatFormatting],
    });
    editor.commands.setTextSelection({ from: 14, to: 19 });
    const el = mount(
      createElement(PhoneSelectionCells, {
        editor: editor as never,
        onBack: () => {},
      }),
    );
    const brush = () =>
      el.querySelector<HTMLElement>('[aria-label="Paint format"]');
    expect(brush()?.getAttribute("aria-disabled")).not.toBe("true");
    act(() => {
      editor?.commands.setMark("inlineCode");
    });
    // Doc changes reach the toolbar after the settle window.
    await act(() => new Promise((resolve) => setTimeout(resolve, 250)));
    const reasonId = brush()
      ?.getAttribute("aria-describedby")
      ?.split(" ")
      .find((id) => document.getElementById(id)?.textContent);
    expect(brush()?.getAttribute("aria-disabled")).toBe("true");
    expect(document.getElementById(reasonId ?? "")?.textContent).toBe(
      "Code has no formatting.",
    );
  });
});

describe("Repeat key with nothing remembered", () => {
  it("shows the reason on the pill", () => {
    editor = createTestEditor({
      content: {
        type: "doc",
        content: [
          {
            type: "heading",
            attrs: { level: 1 },
            content: [{ type: "text", text: "Title" }],
          },
          { type: "paragraph", content: [{ type: "text", text: "hello" }] },
        ],
      },
    });
    editor.commands.setTextSelection({ from: 8, to: 13 });
    v11Engine.repeatKey(editor);
    expect(getNotice()?.text).toBe(
      "Nothing to repeat yet. Format some text or use Paint format.",
    );
  });
});

describe("StatusPill", () => {
  it("shows announce()'s text, hidden from assistive tech, with its action", () => {
    let undone = 0;
    const el = mount(createElement(StatusPill, { placement: "phone" }));
    expect(el.querySelector("[data-status-pill]")).toBeNull();
    act(() =>
      announce("Removed ‘Warning’", {
        done: true,
        action: { label: "Undo", run: () => (undone += 1) },
      }),
    );
    const pill = el.querySelector("[data-status-pill]");
    expect(pill?.textContent).toContain("Removed ‘Warning’");
    expect(pill?.getAttribute("role")).toBeNull();
    expect(pill?.hasAttribute("data-roving-skip")).toBe(true);
    const undo = pill?.querySelector("button");
    expect(undo?.textContent).toBe("Undo");
    act(() => undo?.click());
    expect(undone).toBe(1);
    expect(el.querySelector("[data-status-pill]")).toBeNull();
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

describe("besideBubble (desktop pill placement)", () => {
  const box = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    right: left + width,
    bottom: top + height,
  });

  it("leaves the pill alone when the bubble is closed or elsewhere", () => {
    const pill = box(400, 60, 240, 36);
    expect(besideBubble(pill, undefined, 1440)).toBeNull();
    expect(besideBubble(pill, box(400, 300, 260, 40), 1440)).toBeNull();
  });

  it("moves it 8px right of the bubble, level with it, when that fits", () => {
    const pill = box(400, 60, 240, 36);
    expect(besideBubble(pill, box(380, 50, 260, 40), 1440)).toEqual({
      top: 50,
      left: 648,
    });
  });

  it("else 8px below the bubble", () => {
    const pill = box(100, 60, 240, 36);
    expect(besideBubble(pill, box(80, 50, 260, 40), 500)).toEqual({
      top: 98,
      left: 100,
    });
  });
});

describe("StatusPill Esc", () => {
  it("closes it, unless Paint format is armed", () => {
    const el = mount(createElement(StatusPill, { placement: "phone" }));
    const painting = document.createElement("div");
    painting.className = "is-painting";
    document.body.appendChild(painting);
    act(() => announce("Picked up Bold.", { pill: "Select text to paint" }));
    const esc = () =>
      act(() => {
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
      });
    esc();
    expect(el.querySelector("[data-status-pill]")).not.toBeNull();
    painting.remove();
    esc();
    expect(el.querySelector("[data-status-pill]")).toBeNull();
  });
});
