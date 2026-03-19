import { describe, expect, it } from "vitest";

import { PLAYGROUND_ID } from "@/lib/constants";
import {
  clearMigrationStorage,
  deduplicateTabs,
  deleteDocument,
  ensurePlaygroundTab,
  getDefaultBootstrap,
  getMigrationTabs,
  isTab,
  loadActiveTabIdFromStorage,
  persistActiveTabId,
  type Tab,
} from "@/lib/tab-api";

const tab = (id: string, title = "T"): Tab => ({
  id,
  title,
  createdAt: 1,
});

describe("deduplicateTabs", () => {
  it("removes duplicate ids, keeps first occurrence", () => {
    const input = [tab("a"), tab("b"), tab("a", "dup"), tab("c")];
    const result = deduplicateTabs(input);
    expect(result).toEqual([tab("a"), tab("b"), tab("c")]);
  });

  it("returns same array shape when no duplicates", () => {
    const input = [tab("a"), tab("b")];
    expect(deduplicateTabs(input)).toEqual(input);
  });

  it("handles empty array", () => {
    expect(deduplicateTabs([])).toEqual([]);
  });
});

describe("ensurePlaygroundTab", () => {
  it("prepends playground if missing", () => {
    const result = ensurePlaygroundTab([tab("x")]);
    expect(result[0].id).toBe(PLAYGROUND_ID);
    expect(result).toHaveLength(2);
  });

  it("does not duplicate playground if present", () => {
    const input = [tab(PLAYGROUND_ID), tab("x")];
    const result = ensurePlaygroundTab(input);
    expect(result).toBe(input);
  });

  it("works with empty array", () => {
    const result = ensurePlaygroundTab([]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(PLAYGROUND_ID);
  });
});

describe("isTab", () => {
  it("validates a correct Tab object", () => {
    expect(isTab({ id: "a", title: "T", createdAt: 1 })).toBe(true);
  });

  it("rejects null", () => {
    expect(isTab(null)).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(isTab({ id: "a" })).toBe(false);
    expect(isTab({ id: "a", title: "T" })).toBe(false);
  });

  it("rejects wrong types", () => {
    expect(isTab({ id: 1, title: "T", createdAt: 1 })).toBe(false);
    expect(isTab({ id: "a", title: 5, createdAt: 1 })).toBe(false);
    expect(isTab({ id: "a", title: "T", createdAt: "x" })).toBe(false);
  });

  it("rejects primitives", () => {
    expect(isTab("string")).toBe(false);
    expect(isTab(42)).toBe(false);
    expect(isTab(undefined)).toBe(false);
  });
});

describe("loadActiveTabIdFromStorage / persistActiveTabId", () => {
  it("returns empty string when nothing stored", () => {
    expect(loadActiveTabIdFromStorage()).toBe("");
  });

  it("roundtrips active tab id", () => {
    persistActiveTabId("my-tab");
    expect(loadActiveTabIdFromStorage()).toBe("my-tab");
  });

  it("overwrites previous value", () => {
    persistActiveTabId("first");
    persistActiveTabId("second");
    expect(loadActiveTabIdFromStorage()).toBe("second");
  });

  it("returns empty string for malformed JSON", () => {
    localStorage.setItem("tinydocy-tabs", "not-json");
    expect(loadActiveTabIdFromStorage()).toBe("");
  });
});

describe("getMigrationTabs", () => {
  it("returns null when no stored data", () => {
    expect(getMigrationTabs()).toBeNull();
  });

  it("returns tabs from valid localStorage data", () => {
    const tabs = [tab("a"), tab("b")];
    localStorage.setItem("tinydocy-tabs", JSON.stringify({ tabs }));
    const result = getMigrationTabs();
    expect(result).not.toBeNull();
    expect(result?.some((t) => t.id === PLAYGROUND_ID)).toBe(true);
    expect(result?.some((t) => t.id === "a")).toBe(true);
    expect(result?.some((t) => t.id === "b")).toBe(true);
  });

  it("returns null for invalid tab shapes", () => {
    localStorage.setItem(
      "tinydocy-tabs",
      JSON.stringify({ tabs: [{ id: 123 }] }),
    );
    expect(getMigrationTabs()).toBeNull();
  });

  it("clears storage on parse error", () => {
    localStorage.setItem("tinydocy-tabs", "{bad");
    getMigrationTabs();
    expect(localStorage.getItem("tinydocy-tabs")).toBeNull();
  });
});

describe("clearMigrationStorage", () => {
  it("removes the tabs key", () => {
    localStorage.setItem("tinydocy-tabs", "data");
    clearMigrationStorage();
    expect(localStorage.getItem("tinydocy-tabs")).toBeNull();
  });
});

describe("getDefaultBootstrap", () => {
  it("returns playground + one untitled tab", () => {
    const result = getDefaultBootstrap();
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(PLAYGROUND_ID);
    expect(result[1].title).toBe("Untitled");
    expect(result[1].id).toBeTruthy();
  });

  it("generates unique ids on each call", () => {
    const a = getDefaultBootstrap();
    const b = getDefaultBootstrap();
    expect(a[1].id).not.toBe(b[1].id);
  });
});

describe("deleteDocument", () => {
  it("returns true on 200", async () => {
    globalThis.fetch = async () =>
      new Response(null, { status: 200 }) as Response;
    expect(await deleteDocument("doc-1")).toBe(true);
  });

  it("returns true on 404 (already gone)", async () => {
    globalThis.fetch = async () =>
      new Response(null, { status: 404 }) as Response;
    expect(await deleteDocument("doc-1")).toBe(true);
  });

  it("returns false on 500", async () => {
    globalThis.fetch = async () =>
      new Response(null, { status: 500 }) as Response;
    expect(await deleteDocument("doc-1")).toBe(false);
  });

  it("returns false on network error", async () => {
    globalThis.fetch = async () => {
      throw new Error("network");
    };
    expect(await deleteDocument("doc-1")).toBe(false);
  });
});
