import { describe, expect, it } from "bun:test";

import {
  findAssetRefs,
  formatAssetRef,
  isAssetHex,
  isAssetRef,
  parseAssetRef,
  rewriteAssetRefs,
} from "@/lib/assets/asset-ref";

const HEX = "3f0c".padEnd(64, "a");
const OTHER = "b".repeat(64);

describe("asset refs", () => {
  it("formats and parses a sha256 ref", () => {
    const ref = formatAssetRef(HEX);
    expect(ref).toBe(`asset:sha256-${HEX}`);
    expect(ref).toHaveLength(77);
    expect(parseAssetRef(ref)).toEqual({ alg: "sha256", hex: HEX });
    expect(isAssetRef(ref)).toBe(true);
  });

  it("refuses to format anything but 64 lowercase hex", () => {
    expect(() => formatAssetRef(HEX.toUpperCase())).toThrow();
    expect(() => formatAssetRef(HEX.slice(1))).toThrow();
  });

  it("reads another algorithm as unknown, never as sha256", () => {
    expect(parseAssetRef("asset:blake3-abc")).toEqual({ alg: "unknown" });
    expect(parseAssetRef(`asset:sha512-${HEX}${HEX}`)).toEqual({
      alg: "unknown",
    });
    // An unknown algorithm is still a host src: never rewritten or dropped.
    expect(isAssetRef("asset:blake3-abc")).toBe(true);
  });

  it("refuses malformed sha256 refs", () => {
    for (const bad of [
      `asset:sha256-${HEX.toUpperCase()}`,
      `asset:sha256-${HEX.slice(1)}`,
      `asset:sha256-${HEX}a`,
      "asset:sha256-../x",
      `asset:sha256-${HEX.slice(0, 60)}/../`,
      `ASSET:sha256-${HEX}`,
      ` asset:sha256-${HEX}`,
      `asset:sha256-${HEX}?x`,
      "asset:",
      "asset:-abc",
      "asset:sha256",
    ]) {
      expect(parseAssetRef(bad)).toBeNull();
      expect(isAssetRef(bad)).toBe(false);
    }
  });

  it("is not an asset ref when it is another scheme or not a string", () => {
    for (const other of [
      "https://example.com/a.png",
      "data:image/png;base64,AA==",
      "blob:https://x/1",
      "",
      null,
      undefined,
      42,
    ]) {
      expect(parseAssetRef(other)).toBeNull();
      expect(isAssetRef(other)).toBe(false);
    }
  });

  it("checks bare hex", () => {
    expect(isAssetHex(HEX)).toBe(true);
    expect(isAssetHex(HEX.toUpperCase())).toBe(false);
    expect(isAssetHex(`${HEX}0`)).toBe(false);
  });
});

describe("findAssetRefs and rewriteAssetRefs", () => {
  const md = [
    `![a](asset:sha256-${HEX})`,
    `![b](asset:sha256-${OTHER} "caption")`,
    `![again](asset:sha256-${HEX})`,
    "![c](asset:blake3-zzz)",
    `asset:sha256-${HEX.slice(1)} is too short`,
  ].join("\n");

  it("finds each sha256 hex once, in order of first appearance", () => {
    expect(findAssetRefs(md)).toEqual([HEX, OTHER]);
  });

  it("does not read a longer run as a ref, as parseAssetRef wouldn't", () => {
    for (const longer of [`${HEX}f`, `${HEX}F`, `${HEX}_`, `${HEX}-x`]) {
      const ref = `asset:sha256-${longer}`;
      expect(findAssetRefs(ref)).toEqual([]);
      expect(parseAssetRef(ref)).toBeNull();
    }
    expect(findAssetRefs(`![x](asset:sha256-${HEX})`)).toEqual([HEX]);
  });

  it("rewrites mapped refs and leaves the rest alone", () => {
    const out = rewriteAssetRefs(
      md,
      new Map([[HEX, "doc-images/1-3f0caaaa.png"]]),
    );
    expect(out).toContain("![a](doc-images/1-3f0caaaa.png)");
    expect(out).toContain("![again](doc-images/1-3f0caaaa.png)");
    expect(out).toContain(`asset:sha256-${OTHER}`);
    expect(out).toContain("asset:blake3-zzz");
  });

  it("returns the text unchanged with an empty map", () => {
    expect(rewriteAssetRefs(md, new Map())).toBe(md);
  });
});
