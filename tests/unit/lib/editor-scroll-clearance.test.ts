import { afterEach, describe, expect, it } from "bun:test";

import {
  SCROLL_CLEARANCE,
  setMobileBarClearance,
} from "@/lib/editor-scroll-clearance";

describe("editor scroll clearance", () => {
  afterEach(() => setMobileBarClearance(0));

  it("clears the sticky row on top and 8px of air below by default", () => {
    expect(SCROLL_CLEARANCE.top).toBe(52);
    expect(SCROLL_CLEARANCE.bottom).toBe(8);
    expect(SCROLL_CLEARANCE.left).toBe(0);
    expect(SCROLL_CLEARANCE.right).toBe(0);
  });

  it("keeps one object identity and reads the live bottom", () => {
    const ref = SCROLL_CLEARANCE;
    setMobileBarClearance(44 + 300);
    expect(SCROLL_CLEARANCE).toBe(ref);
    expect(SCROLL_CLEARANCE.bottom).toBe(352);
  });

  it("drops the top clearance while the docked bar replaces the row", () => {
    setMobileBarClearance(44);
    expect(SCROLL_CLEARANCE.top).toBe(8);
    setMobileBarClearance(0);
    expect(SCROLL_CLEARANCE.top).toBe(52);
    expect(SCROLL_CLEARANCE.bottom).toBe(8);
  });

  it("ignores negative and non-finite values", () => {
    setMobileBarClearance(-20);
    expect(SCROLL_CLEARANCE.bottom).toBe(8);
    setMobileBarClearance(Number.NaN);
    expect(SCROLL_CLEARANCE.bottom).toBe(8);
  });
});
