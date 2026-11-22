import { describe, expect, it } from "bun:test";

import {
  FIRST_HIGHLIGHTS,
  FIRST_TEXT_COLORS,
  MORE_HIGHLIGHTS,
  MORE_TEXT_COLORS,
  moreStep,
  type RowsPos,
  rowsStep,
} from "@/components/smart-toolbar/color/color-order";
import { HIGHLIGHT_TOKENS, TEXT_COLOR_TOKENS } from "@/lib/text-style-tokens";

describe("colour display order (spec §7.3)", () => {
  it("shows the curated colours first, in the spec's order", () => {
    expect(FIRST_TEXT_COLORS).toEqual([
      "red",
      "orange",
      "green",
      "blue",
      "purple",
    ]);
    expect(FIRST_HIGHLIGHTS).toEqual(["yellow", "green", "blue", "pink"]);
  });

  it("puts every other token under More, once, in token order", () => {
    expect(MORE_TEXT_COLORS).toEqual([
      "gray",
      "brown",
      "yellow",
      "teal",
      "pink",
    ]);
    expect(MORE_HIGHLIGHTS).toEqual([
      "gray",
      "brown",
      "red",
      "orange",
      "teal",
      "purple",
    ]);
    expect([...FIRST_TEXT_COLORS, ...MORE_TEXT_COLORS].sort()).toEqual(
      [...TEXT_COLOR_TOKENS].sort(),
    );
    expect([...FIRST_HIGHLIGHTS, ...MORE_HIGHLIGHTS].sort()).toEqual(
      [...HIGHLIGHT_TOKENS].sort(),
    );
  });
});

// Text: Default + 5 + More = 7 rows; Highlight: None + 4 + More = 6.
const SIZES = { recent: 3, text: 7, highlight: 6 };
const at = (section: RowsPos["section"], index: number): RowsPos => ({
  section,
  index,
});

describe("rowsStep: arrow keys in the named rows", () => {
  it("moves Up and Down within a column, without wrapping", () => {
    expect(rowsStep(at("text", 2), "ArrowDown", false, SIZES)).toEqual(
      at("text", 3),
    );
    expect(rowsStep(at("text", 6), "ArrowDown", false, SIZES)).toBeNull();
    expect(rowsStep(at("highlight", 3), "ArrowUp", false, SIZES)).toEqual(
      at("highlight", 2),
    );
  });

  it("goes from a column's first row up to Recent, and down again", () => {
    expect(rowsStep(at("highlight", 0), "ArrowUp", false, SIZES)).toEqual(
      at("recent", 0),
    );
    expect(rowsStep(at("recent", 2), "ArrowDown", false, SIZES)).toEqual(
      at("text", 0),
    );
    expect(
      rowsStep(at("text", 0), "ArrowUp", false, { ...SIZES, recent: 0 }),
    ).toBeNull();
  });

  it("crosses columns with Left/Right at the same row, clamped", () => {
    expect(rowsStep(at("text", 2), "ArrowRight", false, SIZES)).toEqual(
      at("highlight", 2),
    );
    expect(rowsStep(at("highlight", 4), "ArrowLeft", false, SIZES)).toEqual(
      at("text", 4),
    );
    // Purple (text row 5) lands on More highlights (highlight row 5).
    expect(rowsStep(at("text", 5), "ArrowRight", false, SIZES)).toEqual(
      at("highlight", 5),
    );
    // Away from the other column: nothing.
    expect(rowsStep(at("text", 2), "ArrowLeft", false, SIZES)).toBeNull();
    expect(rowsStep(at("highlight", 2), "ArrowRight", false, SIZES)).toBeNull();
  });

  it("crosses in visual order in RTL, where Text is on the right", () => {
    expect(rowsStep(at("text", 1), "ArrowLeft", true, SIZES)).toEqual(
      at("highlight", 1),
    );
    expect(rowsStep(at("highlight", 1), "ArrowRight", true, SIZES)).toEqual(
      at("text", 1),
    );
    expect(rowsStep(at("text", 1), "ArrowRight", true, SIZES)).toBeNull();
  });

  it("opens More with the inline-end arrow; the other arrow still crosses", () => {
    expect(rowsStep(at("text", 6), "ArrowRight", false, SIZES)).toBe(
      "open-more",
    );
    expect(rowsStep(at("highlight", 5), "ArrowRight", false, SIZES)).toBe(
      "open-more",
    );
    expect(rowsStep(at("highlight", 5), "ArrowLeft", true, SIZES)).toBe(
      "open-more",
    );
    expect(rowsStep(at("highlight", 5), "ArrowLeft", false, SIZES)).toEqual(
      at("text", 5),
    );
  });

  it("walks Recent in visual order, and Home/End reach a section's ends", () => {
    expect(rowsStep(at("recent", 0), "ArrowRight", false, SIZES)).toEqual(
      at("recent", 1),
    );
    expect(rowsStep(at("recent", 0), "ArrowLeft", true, SIZES)).toEqual(
      at("recent", 1),
    );
    expect(rowsStep(at("recent", 2), "ArrowRight", false, SIZES)).toBeNull();
    expect(rowsStep(at("text", 3), "Home", false, SIZES)).toEqual(
      at("text", 0),
    );
    expect(rowsStep(at("highlight", 1), "End", false, SIZES)).toEqual(
      at("highlight", 5),
    );
  });

  it("ignores other keys", () => {
    expect(rowsStep(at("text", 1), "a", false, SIZES)).toBeUndefined();
  });
});

describe("moreStep: arrow keys in a More submenu", () => {
  it("moves Up/Down, Home/End and closes with the inline-start arrow", () => {
    expect(moreStep(0, "ArrowDown", false, 5)).toBe(1);
    expect(moreStep(4, "ArrowDown", false, 5)).toBeNull();
    expect(moreStep(3, "Home", false, 5)).toBe(0);
    expect(moreStep(0, "End", false, 5)).toBe(4);
    expect(moreStep(2, "ArrowLeft", false, 5)).toBe("close");
    expect(moreStep(2, "ArrowRight", true, 5)).toBe("close");
    expect(moreStep(2, "ArrowRight", false, 5)).toBeNull();
    expect(moreStep(2, "x", false, 5)).toBeUndefined();
  });
});
