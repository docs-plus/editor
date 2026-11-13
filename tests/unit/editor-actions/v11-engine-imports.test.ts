import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * PR E's engine (`lib/editor-actions/v11-engine.ts`) must live in exactly
 * one lazy chunk. Any static import of it from app code copies it into the
 * importer's chunk (the selection bubble and phone cells once carried
 * ~5 KB gz each). Surfaces reach it through `getV11Engine()` /
 * `loadV11Engine()`; the dynamic `import("./v11-engine")` in
 * `v11-actions.ts` is its only importer. Tests may import it to install it.
 */
const root = join(import.meta.dir, "..", "..", "..");
const APP_DIRS = ["app", "components", "extensions", "hooks", "lib"];
const SOURCE = /\.(ts|tsx)$/;
/** A static `import … from` / `import "…"` / `export … from` of the engine. */
const STATIC_IMPORT =
  /^\s*(?:import\s*|(?:import|export)\s[^;()]*?from\s*)["'][^"']*\/v11-engine["']/m;

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir), {
    recursive: true,
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile() && SOURCE.test(entry.name))
    .map((entry) => relative(root, join(entry.parentPath, entry.name)));
}

describe("v11 engine imports", () => {
  const files = APP_DIRS.flatMap(sourceFiles);

  it("scans the app sources", () => {
    expect(files).toContain("lib/editor-actions/v11-actions.ts");
  });

  it("is never imported statically by app code", () => {
    const offenders = files.filter((file) =>
      STATIC_IMPORT.test(readFileSync(join(root, file), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("is loaded only by loadV11Engine", () => {
    const loaders = files.filter((file) =>
      /import\(\s*["'][^"']*v11-engine["']\s*\)/.test(
        readFileSync(join(root, file), "utf8"),
      ),
    );
    expect(loaders).toEqual(["lib/editor-actions/v11-actions.ts"]);
  });
});
