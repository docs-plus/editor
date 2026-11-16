import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../..");
const transpiler = new Bun.Transpiler({ loader: "tsx" });

/**
 * Project files reachable from `entry` through static (runtime) imports.
 * Type-only imports are erased by the transpiler; dynamic `import()` is a
 * separate chunk and is not followed.
 */
function staticProjectFiles(entry: string): Set<string> {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const { imports } = transpiler.scan(readFileSync(file, "utf8"));
    for (const { path: spec, kind } of imports) {
      if (kind !== "import-statement") continue;
      if (!spec.startsWith("@/") && !spec.startsWith(".")) continue;
      const resolved = Bun.resolveSync(spec, path.dirname(file));
      if (!resolved.includes("/node_modules/")) visit(resolved);
    }
  };
  visit(path.join(ROOT, entry));
  return new Set([...seen].map((file) => path.relative(ROOT, file)));
}

// Server code: the API routes, the retention cron and the Hocus server.
const SERVER_ENTRIES = [
  "app/api/documents/[id]/route.ts",
  "app/api/documents/restore/route.ts",
  "app/api/documents/closed/route.ts",
  "scripts/purge-retention.ts",
  "scripts/delete-document.ts",
  "scripts/hocus-server.ts",
];

describe("import boundaries", () => {
  for (const entry of SERVER_ENTRIES) {
    it(`${entry} does not import the client tab API`, () => {
      expect([...staticProjectFiles(entry)]).not.toContain("lib/tab-api.ts");
    });
  }
});
