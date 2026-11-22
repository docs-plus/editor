import { afterEach, describe, expect, it } from "bun:test";

import type { Editor, Extension } from "@tiptap/core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

import {
  ColorPanel,
  type ColorPanelProps,
} from "@/components/smart-toolbar/color/color-panel";
import { ActionPreview } from "@/extensions/action-preview";
import { dismissNotice, getNotice } from "@/lib/announce";
import type { RecentColor } from "@/lib/remembered-choice";

import {
  createTestEditor,
  DEFAULT_EXTENSIONS,
} from "../../helpers/create-test-editor";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement | null = null;
let editor: Editor | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  editor?.destroy();
  root = null;
  host = null;
  editor = null;
  dismissNotice();
});

function mount(
  props: Partial<ColorPanelProps> & { recent?: readonly RecentColor[] } = {},
): HTMLElement {
  editor = createTestEditor({
    extensions: [...DEFAULT_EXTENSIONS, ActionPreview] as Extension[],
    content: {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        { type: "paragraph", content: [{ type: "text", text: "Some words" }] },
      ],
    },
  });
  // "Some" in the paragraph.
  editor.commands.setTextSelection({ from: 8, to: 12 });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const target = editor;
  act(() => {
    root?.render(
      createElement(ColorPanel, {
        editor: target as never,
        recent: [],
        focusKind: "text",
        ...props,
      }),
    );
  });
  return host;
}

const group = (container: HTMLElement, name: string) =>
  [...container.querySelectorAll<HTMLElement>('[role="group"]')].find(
    (el) =>
      el.getAttribute("aria-label") === name ||
      document
        .getElementById(el.getAttribute("aria-labelledby") ?? "")
        ?.textContent?.startsWith(name),
  );

const names = (el: HTMLElement | undefined, role: string) =>
  [...(el?.querySelectorAll(`[role="${role}"]`) ?? [])].map((item) =>
    item.getAttribute("aria-label"),
  );

const item = (container: HTMLElement, name: string) =>
  container.querySelector<HTMLElement>(`[aria-label="${name}"]`);

/** The toolbar store settles document changes (`TOOLBAR_SETTLE_MS`). */
const settle = () =>
  act(() => new Promise<void>((resolve) => setTimeout(resolve, 250)));

const key = (target: HTMLElement, k: string) =>
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key: k, bubbles: true }),
    );
  });

describe("ColorPanel rows layout (spec §7.3, the default)", () => {
  it("is a menu with Text and Highlight groups of named radio rows", () => {
    const container = mount();
    expect(container.querySelector('[role="menu"]')).not.toBeNull();
    expect(names(group(container, "Text"), "menuitemradio")).toEqual([
      "Default text",
      "Red text",
      "Orange text",
      "Green text",
      "Blue text",
      "Purple text",
    ]);
    expect(names(group(container, "Highlight"), "menuitemradio")).toEqual([
      "No highlight",
      "Yellow highlight",
      "Green highlight",
      "Blue highlight",
      "Pink highlight",
    ]);
    // The rest wait under More.
    expect(item(container, "Teal text")).toBeNull();
    expect(
      group(container, "Text")?.querySelector('[role="menuitem"]')?.textContent,
    ).toContain("More colours");
    expect(
      group(container, "Highlight")?.querySelector('[role="menuitem"]')
        ?.textContent,
    ).toContain("More highlights");
  });

  it("shows the visible colour name and checks the current value", async () => {
    const container = mount();
    const red = item(container, "Red text");
    expect(red?.textContent).toContain("Red");
    expect(item(container, "Default text")?.getAttribute("aria-checked")).toBe(
      "true",
    );
    expect(red?.getAttribute("aria-checked")).toBe("false");
    act(() => {
      red?.click();
    });
    await settle();
    expect(red?.getAttribute("aria-checked")).toBe("true");
    expect(editor?.getHTML()).toContain('data-text-color="red"');
  });

  it("puts Recent first, up to five chips", () => {
    const container = mount({
      recent: [
        { kind: "highlight", token: "teal" },
        { kind: "text", token: "pink" },
      ],
    });
    const recent = group(container, "Recent");
    // Recent chips apply a colour; the radio state lives in the columns.
    expect(names(recent, "menuitem")).toEqual(["Teal highlight", "Pink text"]);
    const all = [...container.querySelectorAll('[role="group"]')];
    expect(all[0]).toBe(recent as Element);
  });

  it("starts the roving stop on the checked row of the asked column", () => {
    const container = mount({ focusKind: "highlight" });
    expect(item(container, "No highlight")?.getAttribute("tabindex")).toBe("0");
    expect(item(container, "Default text")?.getAttribute("tabindex")).toBe(
      "-1",
    );
  });

  it("crosses columns with Left/Right at the same row", () => {
    const container = mount();
    const orange = item(container, "Orange text") as HTMLElement;
    act(() => orange.focus());
    key(orange, "ArrowRight");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Green highlight",
    );
    key(document.activeElement as HTMLElement, "ArrowDown");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Blue highlight",
    );
    key(document.activeElement as HTMLElement, "ArrowLeft");
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Green text",
    );
  });
});

describe("ColorPanel grid layout (phone Aa sheet)", () => {
  it("keeps the swatch grid of aria-pressed buttons", () => {
    const container = mount({ layout: "grid", focusOnMount: false });
    expect(container.querySelector('[role="menu"]')).toBeNull();
    const teal = container.querySelector<HTMLElement>(
      'button[aria-label="Teal text"]',
    );
    expect(teal?.getAttribute("aria-pressed")).toBe("false");
  });

  it("names the current value under the grid", async () => {
    const container = mount({
      layout: "grid",
      caption: "current",
      focusOnMount: false,
    });
    const caption = container.querySelector(".st-color-caption");
    expect(caption?.textContent).toBe("Current: Default text, No highlight");
    act(() => {
      container
        .querySelector<HTMLElement>('button[aria-label="Teal text"]')
        ?.click();
    });
    await settle();
    expect(caption?.textContent).toBe("Current: Teal text, No highlight");
  });

  it("a pick shows a pill naming the colour, whose Undo takes it back", () => {
    const container = mount({ layout: "grid", focusOnMount: false });
    act(() => {
      container
        .querySelector<HTMLElement>('button[aria-label="Teal text"]')
        ?.click();
    });
    expect(editor?.getHTML()).toContain('data-text-color="teal"');
    const notice = getNotice();
    expect(notice?.text).toBe("Teal text");
    expect(notice?.done).toBe(true);
    expect(notice?.action?.label).toBe("Undo");
    act(() => notice?.action?.run());
    expect(editor?.getHTML()).not.toContain("data-text-color");
  });
});
