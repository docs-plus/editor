import { afterEach, describe, expect, it } from "bun:test";

import {
  isNewItem,
  localDay,
  MAX_NEW_BADGES,
  NEW_UNTIL,
} from "@/lib/slash-menu/slash-badges";
import type { SlashItem } from "@/lib/slash-menu/slash-items";

type BadgeWindow = { __SLASH_NEW_UNTIL?: Record<string, string> };

const item = (key: string, actionId = key): SlashItem => ({
  key,
  actionId,
  label: key,
  keywords: [],
  section: "Insert",
});

afterEach(() => {
  delete (globalThis as BadgeWindow).__SLASH_NEW_UNTIL;
});

describe("New badges", () => {
  it("ships empty, and never declares more than two", () => {
    expect(NEW_UNTIL).toEqual({});
    expect(Object.keys(NEW_UNTIL).length).toBeLessThanOrEqual(MAX_NEW_BADGES);
  });

  it("shows through its last day, then hides", () => {
    (globalThis as BadgeWindow).__SLASH_NEW_UNTIL = {
      "insert.divider": "2026-12-01",
    };
    const divider = item("insert.divider");
    expect(isNewItem(divider, "2026-11-22", [])).toBe(true);
    expect(isNewItem(divider, "2026-12-01", [])).toBe(true);
    expect(isNewItem(divider, "2026-12-02", [])).toBe(false);
    expect(isNewItem(item("insert.table"), "2026-11-22", [])).toBe(false);
  });

  it("hides once the writer has used the kind, and follows a Suggested copy", () => {
    (globalThis as BadgeWindow).__SLASH_NEW_UNTIL = {
      "template.mermaid:pie": "2026-12-01",
    };
    const pie = item("template.mermaid:pie", "template.mermaid");
    expect(isNewItem(pie, "2026-11-22", ["table"])).toBe(true);
    expect(
      isNewItem(
        { ...pie, key: "suggested:template.mermaid:pie" },
        "2026-11-22",
        [],
      ),
    ).toBe(true);
    expect(isNewItem(pie, "2026-11-22", ["mermaid"])).toBe(false);
  });

  it("formats the local day", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});
