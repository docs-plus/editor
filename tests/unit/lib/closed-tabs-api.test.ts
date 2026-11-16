import { afterEach, describe, expect, it, vi } from "bun:test";

import {
  fetchClosedDocuments,
  formatClosedAgo,
  restoreDocuments,
} from "@/lib/closed-tabs-api";
import { closeDocument } from "@/lib/tab-api";

describe("formatClosedAgo", () => {
  it("rounds to the largest unit", () => {
    expect(formatClosedAgo(0, 30_000)).toBe("just now");
    expect(formatClosedAgo(0, 5 * 60_000)).toBe("5 min ago");
    expect(formatClosedAgo(0, 3 * 3_600_000)).toBe("3 h ago");
    expect(formatClosedAgo(0, 2 * 86_400_000)).toBe("2 d ago");
  });
});

describe("close, restore and list requests", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("closeDocument sends the title and the tabs document", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ closed: true }));
    expect(await closeDocument("doc-1", "Plan")).toBe(true);
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({
      title: "Plan",
      tabsDoc: "global-tabs",
    });
  });

  it("restoreDocuments returns the results, and null on a network error or a 500", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ results: { a: "restored" } }));
    expect(await restoreDocuments(["a"])).toEqual({ a: "restored" });
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/documents/restore",
      expect.objectContaining({
        method: "POST",
        body: '{"ids":["a"]}',
      }),
    );

    fetchSpy.mockResolvedValue(new Response(null, { status: 500 }));
    expect(await restoreDocuments(["a"])).toBeNull();

    fetchSpy.mockRejectedValue(new Error("network"));
    expect(await restoreDocuments(["a"])).toBeNull();
  });

  it("fetchClosedDocuments reads the caller's tab list, and null on failure", async () => {
    const body = { documents: [], retentionDays: 7, disabled: false };
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json(body));
    expect(await fetchClosedDocuments()).toEqual(body);
    expect(String(fetchSpy.mock.calls[0]?.[0])).toBe(
      "/api/documents/closed?tabs=global-tabs",
    );

    fetchSpy.mockResolvedValue(new Response(null, { status: 429 }));
    expect(await fetchClosedDocuments()).toBeNull();
  });
});
