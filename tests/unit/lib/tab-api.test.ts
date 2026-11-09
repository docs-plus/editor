import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import { repairTabsArray } from "@/lib/security/tabs-doc-repair";
import { findRawTabIndex, sanitizeTabs } from "@/lib/tab-api";

const VALID = {
  id: "11111111-1111-1111-1111-111111111111",
  title: "Notes",
  createdAt: 1,
};
const POISON: unknown[] = [
  null,
  1,
  "tab",
  { id: "x2", title: { a: 1 }, createdAt: 0 },
  { id: "../a", title: "t", createdAt: 0 },
  { id: "global-tabs", title: "t", createdAt: 0 },
  {
    id: "22222222-2222-2222-2222-222222222222",
    title: "t",
    createdAt: Number.NaN,
  },
];

describe("sanitizeTabs (A01-1)", () => {
  it("keeps only valid entries, playground first", () => {
    const tabs = sanitizeTabs([...POISON, VALID, VALID]);
    expect(tabs.map((t) => t.id)).toEqual(["playground", VALID.id]);
  });

  it("trims titles and caps the list", () => {
    const long = { ...VALID, title: "x".repeat(5000) };
    expect(sanitizeTabs([long])[1]?.title).toHaveLength(200);
    const many = Array.from({ length: 80 }, (_, i) => ({
      id: `tab-${i}`,
      title: "t",
      createdAt: i,
    }));
    expect(sanitizeTabs(many, 50)).toHaveLength(50);
  });

  it("finds raw indices past malformed entries", () => {
    expect(findRawTabIndex([null, { a: 1 }, VALID], VALID.id)).toBe(2);
    expect(findRawTabIndex([null], VALID.id)).toBe(-1);
  });
});

describe("repairTabsArray", () => {
  it("removes malformed and duplicate entries in one transaction", () => {
    const doc = new Y.Doc();
    const tabs = doc.getArray<unknown>("tabs");
    tabs.push([...POISON, VALID, VALID]);
    let transactions = 0;
    doc.on("afterTransaction", () => transactions++);

    expect(repairTabsArray(tabs)).toBe(POISON.length + 1);
    expect(tabs.toArray()).toEqual([VALID]);
    expect(transactions).toBe(1);
    expect(repairTabsArray(tabs)).toBe(0);
  });
});
