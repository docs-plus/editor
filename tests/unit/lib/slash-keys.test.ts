import { describe, expect, it } from "bun:test";

import {
  pageIndex,
  type RowSpan,
  slashKey,
  stepIndex,
} from "@/lib/slash-menu/slash-keys";

function view(composing = false) {
  const dom = document.createElement("div");
  const inner = document.createElement("p");
  dom.append(inner);
  return { dom, inner, composing };
}

/** A keydown aimed at `target`, as the window's capture listener sees it. */
function keydown(target: Element, key: string, init: KeyboardEventInit = {}) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, ...init });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("slashKey", () => {
  it("takes ↑, ↓, Home, End, Page Up, Page Down, Enter and Esc aimed at the editor", () => {
    const v = view();
    for (const key of [
      "ArrowUp",
      "ArrowDown",
      "Home",
      "End",
      "PageUp",
      "PageDown",
      "Enter",
      "Escape",
    ] as const) {
      expect(slashKey(keydown(v.inner, key), v)).toBe(key);
    }
    expect(slashKey(keydown(v.inner, "a"), v)).toBeNull();
    expect(slashKey(keydown(v.inner, "Tab"), v)).toBeNull();
  });

  it("leaves modified keys to the editor (Shift+Enter is a line break)", () => {
    const v = view();
    for (const mod of ["shiftKey", "altKey", "ctrlKey", "metaKey"]) {
      expect(
        slashKey(keydown(v.inner, "Enter", { [mod]: true }), v),
      ).toBeNull();
    }
    // Shift+End selects to the line end; Ctrl+Home goes to the top.
    expect(slashKey(keydown(v.inner, "End", { shiftKey: true }), v)).toBeNull();
    expect(slashKey(keydown(v.inner, "Home", { ctrlKey: true }), v)).toBeNull();
  });

  it("takes no key while an IME composition is open", () => {
    const v = view();
    expect(
      slashKey(keydown(v.inner, "Enter", { isComposing: true }), v),
    ).toBeNull();
    expect(slashKey(keydown(v.inner, "Enter", { keyCode: 229 }), v)).toBeNull();
    const composing = view(true);
    expect(slashKey(keydown(composing.inner, "Escape"), composing)).toBeNull();
  });

  it("ignores keys aimed outside this editor", () => {
    const v = view();
    const elsewhere = document.createElement("input");
    expect(slashKey(keydown(elsewhere, "Enter"), v)).toBeNull();
  });
});

describe("stepIndex", () => {
  it("arrows wrap, and from no active row go to the first or the last", () => {
    expect(stepIndex("ArrowDown", 0, 5)).toBe(1);
    expect(stepIndex("ArrowDown", 4, 5)).toBe(0);
    expect(stepIndex("ArrowUp", 0, 5)).toBe(4);
    expect(stepIndex("ArrowUp", 3, 5)).toBe(2);
    expect(stepIndex("ArrowDown", -1, 5)).toBe(0);
    expect(stepIndex("ArrowUp", -1, 5)).toBe(4);
  });

  it("Home and End go to the first and the last option", () => {
    for (const index of [-1, 0, 2, 4]) {
      expect(stepIndex("Home", index, 5)).toBe(0);
      expect(stepIndex("End", index, 5)).toBe(4);
    }
  });
});

describe("pageIndex", () => {
  /** `count` 32 px rows from 4 px (the list's padding). */
  const rows = (count: number, height = 32): RowSpan[] =>
    Array.from({ length: count }, (_, i) => ({
      top: 4 + i * height,
      bottom: 4 + (i + 1) * height,
    }));

  it("moves to the farthest option on one page with the active one", () => {
    // 100 px: three 32 px rows share a page.
    expect(pageIndex(rows(10), 0, 100, true)).toBe(2);
    expect(pageIndex(rows(10), 2, 100, true)).toBe(4);
    expect(pageIndex(rows(10), 9, 100, false)).toBe(7);
    expect(pageIndex(rows(10), 7, 100, false)).toBe(5);
  });

  it("stops at the ends instead of wrapping", () => {
    expect(pageIndex(rows(10), 8, 100, true)).toBe(9);
    expect(pageIndex(rows(10), 9, 100, true)).toBe(9);
    expect(pageIndex(rows(10), 1, 100, false)).toBe(0);
    expect(pageIndex(rows(10), 0, 100, false)).toBe(0);
  });

  it("from no active row: the first page's last option, or the last page's first", () => {
    expect(pageIndex(rows(10), -1, 100, true)).toBe(2);
    expect(pageIndex(rows(10), -1, 100, false)).toBe(7);
  });

  it("always moves at least one option (a page shorter than a row)", () => {
    expect(pageIndex(rows(10), 3, 20, true)).toBe(4);
    expect(pageIndex(rows(10), 3, 20, false)).toBe(2);
  });

  it("counts section headings as space, not as options", () => {
    // Two options, a 28 px heading, two more.
    const spans: RowSpan[] = [
      { top: 0, bottom: 32 },
      { top: 32, bottom: 64 },
      { top: 92, bottom: 124 },
      { top: 124, bottom: 156 },
    ];
    expect(pageIndex(spans, 0, 128, true)).toBe(2);
    expect(pageIndex(spans, 3, 128, false)).toBe(1);
  });

  it("an empty list has no target", () => {
    expect(pageIndex([], -1, 100, true)).toBe(-1);
  });
});
