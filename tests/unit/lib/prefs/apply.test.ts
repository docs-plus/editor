import { afterEach, describe, expect, it } from "bun:test";

import { applyPrefs } from "@/lib/prefs/apply";
import { pageProperties } from "@/lib/prefs/schema";

const root = () => document.documentElement;

afterEach(() => {
  root().removeAttribute("style");
  root().removeAttribute("data-text-size");
});

describe("applyPrefs", () => {
  it("writes, replaces and clears the card's inline knob variables", () => {
    applyPrefs(
      { "data-text-size": "20" },
      pageProperties({ style: "default", size: 20, width: "full" }),
    );
    expect(root().style.getPropertyValue("--page-size")).toBe("1.25rem");
    expect(root().style.getPropertyValue("--page-measure")).toBe("10000");

    // Another tab went back to Default: nothing inline is left behind.
    applyPrefs({}, pageProperties({ style: "default" }));
    expect(root().style.getPropertyValue("--page-size")).toBe("");
    expect(root().style.getPropertyValue("--page-measure")).toBe("");
    expect(root().hasAttribute("data-text-size")).toBe(false);
  });

  it("classic writes no inline variable", () => {
    expect(pageProperties({ style: "classic" })).toEqual({});
  });
});
