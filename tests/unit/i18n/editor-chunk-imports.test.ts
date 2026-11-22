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
  /^lib\/i18n\/locale\.ts$/,
  /^locales\//,
  /^scripts\/i18n\//,
];

/** The only `lib/i18n` files the editor chunk may carry (L1a's ledger line). */
const EAGER_I18N = [
  "lib/i18n/dir.ts",
  "lib/i18n/registry-labels.ts",
  "lib/i18n/t-core.ts",
];

const offendersIn = (files: Set<string>) =>
  [...files].filter((file) => FORBIDDEN.some((pattern) => pattern.test(file)));
const i18nFilesIn = (files: Set<string>) =>
  [...files].filter((file) => file.startsWith("lib/i18n/")).sort();

describe("editor chunk i18n imports", () => {
  const files = reachable(ENTRY);

  it("walks the editor's static graph", () => {
    expect(files.size).toBeGreaterThan(50);
    expect(files.has(ENTRY)).toBe(true);
  });

  it("never reaches the formatter, Intl helpers, catalogs or scripts", () => {
    expect(offendersIn(files)).toEqual([]);
  });

  it("carries only the eager i18n files", () => {
    for (const file of i18nFilesIn(files)) expect(EAGER_I18N).toContain(file);
  });
});

describe("the eager i18n modules", () => {
  // The editor test above passes vacuously until L1a wires `t-core` in, so
  // pin what the eager modules pull in themselves.
  it("t-core and registry-labels reach only dir.ts and each other", () => {
    expect(i18nFilesIn(reachable("lib/i18n/registry-labels.ts"))).toEqual(
      EAGER_I18N,
    );
    expect(i18nFilesIn(reachable("lib/i18n/t-core.ts"))).toEqual([
      "lib/i18n/dir.ts",
      "lib/i18n/t-core.ts",
    ]);
  });

  it("would flag a graph that reaches the formatter (positive control)", () => {
    expect(offendersIn(reachable("scripts/i18n/check.ts"))).toEqual(
      expect.arrayContaining(["lib/i18n/format.ts", "scripts/i18n/check.ts"]),
    );
  });
});
