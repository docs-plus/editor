import { describe, expect, it } from "bun:test";

import { slashKey } from "@/lib/slash-menu/slash-keys";

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
  it("takes ↑, ↓, Enter and Esc aimed at the editor", () => {
    const v = view();
    for (const key of ["ArrowUp", "ArrowDown", "Enter", "Escape"] as const) {
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
