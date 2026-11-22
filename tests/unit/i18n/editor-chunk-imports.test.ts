/**
 * The editor chunk never carries the ICU formatter, the `Intl` helpers, a
 * catalog or the i18n scripts (languages design §3.7, §8.1): lazy chunks
 * import those, and the editor's eager cost stays inside L1a's 400 B gz
 * ledger line (`t-core`, the registry lookups, `lang` / `dir`).
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../..");
const ENTRY = "components/document-editor/document-editor.tsx";
const LOADERS = {
  ".ts": new Bun.Transpiler({ loader: "ts" }),
  ".tsx": new Bun.Transpiler({ loader: "tsx" }),
  ".js": new Bun.Transpiler({ loader: "js" }),
} as Record<string, Bun.Transpiler | undefined>;

/**
 * Project files reachable through static imports (one chunk's graph).
 * Styles and JSON are recorded but not scanned.
 */
function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const transpiler = LOADERS[path.extname(file)];
    if (!transpiler) return;
    const { imports } = transpiler.scan(readFileSync(file, "utf8"));
    for (const { path: spec, kind } of imports) {
      if (kind !== "import-statement") continue;
      if (!spec.startsWith("@/") && !spec.startsWith(".")) continue;
      if (spec.includes("node_modules/")) continue;
      const resolved = Bun.resolveSync(spec, path.dirname(file));
      if (!resolved.includes("/node_modules/")) visit(resolved);
    }
  };
  visit(path.join(ROOT, entry));
  return new Set([...seen].map((file) => path.relative(ROOT, file)));
}

const FORBIDDEN = [
  /^lib\/i18n\/format\.ts$/,
  /^lib\/i18n\/intl\.ts$/,
  /^locales\//,
  /^scripts\/i18n\//,
];

describe("editor chunk i18n imports", () => {
  const files = reachable(ENTRY);

  it("walks the editor's static graph", () => {
    expect(files.size).toBeGreaterThan(50);
    expect(files.has(ENTRY)).toBe(true);
  });

  it("never reaches the formatter, Intl helpers, catalogs or scripts", () => {
    const offenders = [...files].filter((file) =>
      FORBIDDEN.some((pattern) => pattern.test(file)),
    );
    expect(offenders).toEqual([]);
  });
});
