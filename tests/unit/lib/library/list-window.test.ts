import { describe, expect, it } from "bun:test";

import {
  anchoredScrollTop,
  rowOffsets,
  scrollToShow,
  visibleRange,
} from "@/lib/library/list-window";

describe("rowOffsets", () => {
  it("adds heights up; the last entry is the total", () => {
    expect([...rowOffsets([28, 32, 32])]).toEqual([0, 28, 60, 92]);
  });
});

describe("visibleRange", () => {
  const offsets = rowOffsets(Array.from({ length: 1000 }, () => 10));

  it("covers the viewport plus overscan", () => {
    expect(visibleRange(offsets, 0, 100, 2)).toEqual({ start: 0, end: 12 });
    expect(visibleRange(offsets, 505, 100, 2)).toEqual({ start: 48, end: 63 });
  });

  it("clamps at the end and for an empty list", () => {
    expect(visibleRange(offsets, 99_990, 100, 2)).toEqual({
      start: 997,
      end: 1000,
    });
    expect(visibleRange(rowOffsets([]), 0, 100, 2)).toEqual({
      start: 0,
      end: 0,
    });
  });
});

describe("scrollToShow", () => {
  const offsets = rowOffsets([10, 10, 10, 10, 10]);
  it("scrolls only as far as needed", () => {
    expect(scrollToShow(offsets, 0, 0, 25)).toBe(0);
    expect(scrollToShow(offsets, 3, 0, 25)).toBe(15);
    expect(scrollToShow(offsets, 0, 30, 25)).toBe(0);
  });
});

describe("anchoredScrollTop", () => {
  it("keeps the anchor row where it was after rows above it change", () => {
    const before = rowOffsets([10, 10, 10, 10]);
    const after = rowOffsets([10, 10, 10, 10, 10]);
    // Anchor: row "c" (index 2 before) 5 px above the top.
    const top = anchoredScrollTop(
      { key: "c", delta: before[2] - 25 },
      ["x", "a", "b", "c", "d"],
      after,
    );
    expect(top).toBe(35);
  });

  it("is null when the anchor is gone", () => {
    expect(
      anchoredScrollTop({ key: "z", delta: 0 }, ["a"], rowOffsets([10])),
    ).toBeNull();
  });
});
