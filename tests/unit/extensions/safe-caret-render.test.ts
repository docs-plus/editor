import { describe, expect, it } from "bun:test";

import {
  renderCaret,
  renderCaretSelection,
} from "@/extensions/collaboration-caret/safe-caret-render";

/** happy-dom may report a colour as `rgb(\u2026)`: compare as lowercase hex. */
function toHex(css: string): string {
  const rgb = css.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!rgb) return css.toLowerCase();
  return `#${rgb
    .slice(1, 4)
    .map((part) => Number(part).toString(16).padStart(2, "0"))
    .join("")}`;
}

const labelOf = (el: HTMLElement) =>
  el.querySelector<HTMLElement>(".collaboration-carets__label");

describe("renderCaret", () => {
  it("keeps the upstream DOM and repairs a hostile name and colour", () => {
    const el = renderCaret({
      name: `\u202Eevil${"x".repeat(100)}`,
      color: "red;background:url(//x)",
    });
    expect(el.className).toBe("collaboration-carets__caret");
    expect(toHex(el.style.borderColor)).toBe("#9e9e9e");
    const label = labelOf(el);
    expect(label?.className).toBe("collaboration-carets__label");
    expect(toHex(label?.style.backgroundColor ?? "")).toBe("#9e9e9e");
    expect(label?.textContent).toBe(`evil${"x".repeat(28)}`);
    expect(label?.children.length).toBe(0);
  });

  it("inserts the name as text, never markup", () => {
    const el = renderCaret({
      name: "<img src=x onerror=alert(1)>",
      color: "#E57373",
    });
    expect(el.querySelector("img")).toBeNull();
    expect(labelOf(el)?.textContent).toBe("<img src=x onerror=alert(1)>");
  });

  it("renders an empty label for a name that cleans to nothing or is not a string", () => {
    expect(
      labelOf(renderCaret({ name: "\u200B", color: "#E57373" }))?.textContent,
    ).toBe("");
    expect(
      labelOf(renderCaret({ name: 5, color: "#E57373" }))?.textContent,
    ).toBe("");
    expect(labelOf(renderCaret({ color: "#E57373" }))?.textContent).toBe("");
  });

  it("keeps a valid colour, canonicalising palette entries", () => {
    expect(
      toHex(renderCaret({ name: "A", color: "#e57373" }).style.borderColor),
    ).toBe("#e57373");
    expect(
      toHex(renderCaret({ name: "A", color: "#123abc" }).style.borderColor),
    ).toBe("#123abc");
  });
});

describe("renderCaretSelection", () => {
  it("matches the upstream selection builder with a repaired colour", () => {
    expect(renderCaretSelection({ color: "transparent" })).toEqual({
      style: "background-color: #9E9E9E70",
      class: "ProseMirror-yjs-selection",
    });
    expect(renderCaretSelection({ color: "#e57373" }).style).toBe(
      "background-color: #E5737370",
    );
  });
});
