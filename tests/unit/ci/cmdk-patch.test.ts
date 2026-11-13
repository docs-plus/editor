import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `patches/cmdk@1.1.1.patch` (PR E) edits cmdk's minified dist so the
 * search field's `aria-activedescendant` follows a `value` set from props
 * (WCAG 4.1.2). It is pinned to that exact version: any cmdk upgrade must
 * drop the patch (if upstream fixed it) or re-make it with
 * `bun patch cmdk`, then update this test. Until then the version stays
 * exact and the installed dist must carry the patch.
 */
const root = join(import.meta.dir, "..", "..", "..");
const PATCHED = "cmdk@1.1.1";
/** Present only in the patched dist: the value effect re-syncs the id. */
const MARKER =
  /value=\w+,\w+\(7,\(\)=>\{var \w+\s*\w+\.current\.selectedItemId=/;

const readJson = (path: string) =>
  JSON.parse(readFileSync(join(root, path), "utf8")) as Record<string, unknown>;

describe("cmdk patch", () => {
  const pkg = readJson("package.json") as {
    dependencies: Record<string, string>;
    patchedDependencies: Record<string, string>;
  };

  it("pins cmdk to the exact version the patch was made for", () => {
    expect(pkg.dependencies.cmdk).toBe("1.1.1");
    expect(pkg.patchedDependencies[PATCHED]).toBe(`patches/${PATCHED}.patch`);
    expect(readJson("node_modules/cmdk/package.json").version).toBe("1.1.1");
  });

  it("is applied to both builds of the installed dist", () => {
    for (const file of ["index.js", "index.mjs"]) {
      const source = readFileSync(
        join(root, "node_modules/cmdk/dist", file),
        "utf8",
      ).replaceAll(";", "\n");
      expect(source).toMatch(MARKER);
    }
  });
});
