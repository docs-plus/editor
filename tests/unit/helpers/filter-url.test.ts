import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  decodeFilterParams,
  readFilterUrl,
  updateFilterUrl,
} from "@/extensions/heading-filter";

describe("decodeFilterParams", () => {
  it("valid params → correct { slugs, mode }", () => {
    const result = decodeFilterParams("?filter=foo%7Cbar&mode=or");
    expect(result).toEqual({ slugs: ["foo", "bar"], mode: "or" });
  });

  it("missing params → null", () => {
    expect(decodeFilterParams("")).toBeNull();
    expect(decodeFilterParams("?other=1")).toBeNull();
  });

  it("mode=and → mode is 'and'", () => {
    const result = decodeFilterParams("?filter=test&mode=and");
    expect(result?.mode).toBe("and");
  });

  it("no mode param → defaults to 'or'", () => {
    const result = decodeFilterParams("?filter=test");
    expect(result?.mode).toBe("or");
  });

  it("empty filter value → null", () => {
    expect(decodeFilterParams("?filter=&mode=or")).toBeNull();
    expect(decodeFilterParams("?filter=|")).toBeNull();
  });
});

describe("updateFilterUrl", () => {
  let replaceStateSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    replaceStateSpy = vi
      .spyOn(history, "replaceState")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    replaceStateSpy.mockRestore();
  });

  it("with slugs → calls replaceState with filter and mode params", () => {
    Object.defineProperty(window, "location", {
      value: { href: "http://localhost/", origin: "http://localhost" },
      writable: true,
      configurable: true,
    });
    updateFilterUrl(["foo", "bar"], "or");
    const url = replaceStateSpy.mock.calls[0][2] as string;
    expect(url).toMatch(/filter=foo%7Cbar/);
    expect(url).toContain("mode=or");
  });

  it("with empty slugs → removes params", () => {
    Object.defineProperty(window, "location", {
      value: {
        href: "http://localhost/?filter=old&mode=or",
        origin: "http://localhost",
      },
      writable: true,
      configurable: true,
    });
    updateFilterUrl([], "or");
    const url = replaceStateSpy.mock.calls[0][2] as string;
    expect(url).not.toContain("filter=");
    expect(url).not.toContain("mode=");
  });
});

describe("readFilterUrl", () => {
  beforeEach(() => {
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost/"),
      writable: true,
    });
  });

  it("returns decoded params from window.location.search", () => {
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost/?filter=hello%7Cworld&mode=and"),
      writable: true,
    });
    const result = readFilterUrl();
    expect(result).toEqual({ slugs: ["hello", "world"], mode: "and" });
  });

  it("returns null when no filter param", () => {
    Object.defineProperty(window, "location", {
      value: new URL("http://localhost/"),
      writable: true,
    });
    expect(readFilterUrl()).toBeNull();
  });
});
