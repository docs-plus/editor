import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../..");
const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};
/** Only scripts: style sheets and assets have no imports to follow. */
const SCRIPT = /\.(tsx?|m?js)$/;

/**
 * Project files and packages reachable from `entry` through static (runtime)
 * imports. Type-only imports are erased by the transpiler; dynamic
 * `import()` is a separate chunk and is not followed.
 */
function staticImports(entry: string): {
  files: Set<string>;
  packages: Set<string>;
} {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || !SCRIPT.test(file)) return;
    seen.add(file);
    const transpiler = file.endsWith(".ts") ? transpilers.ts : transpilers.tsx;
    const { imports } = transpiler.scan(readFileSync(file, "utf8"));
    for (const { path: spec, kind } of imports) {
      if (kind !== "import-statement") continue;
      if (spec.startsWith("@/") || spec.startsWith(".")) {
        const resolved = Bun.resolveSync(spec, path.dirname(file));
        if (!resolved.includes("/node_modules/")) visit(resolved);
      } else {
        packages.add(spec);
      }
    }
  };
  visit(path.join(ROOT, entry));
  return {
    files: new Set([...seen].map((file) => path.relative(ROOT, file))),
    packages,
  };
}

// Server code: the API routes, the retention cron and the Hocus server must
// never load the client tab API or the browser collaboration provider.
const SERVER_ENTRIES = [
  "app/api/documents/[id]/route.web.ts",
  "app/api/documents/restore/route.web.ts",
  "app/api/documents/closed/route.web.ts",
  "scripts/purge-retention.ts",
  "scripts/delete-document.ts",
  "scripts/hocus-server.ts",
];

// The platform-neutral storage path (desktop architecture §3.3, D-A4): shared
// by desktop and the web library, so it must not load the sandbox's
// collaboration stack, its offline copies, React or the editor.
const PLATFORM_ENTRIES = [
  "lib/platform/local-session.ts",
  "lib/platform/memory-doc-store.ts",
];

describe("platform import boundaries", () => {
  for (const entry of PLATFORM_ENTRIES) {
    it(`${entry} loads no sandbox, React or editor code`, () => {
      const { files, packages } = staticImports(entry);
      for (const file of files) {
        expect(file).not.toBe("lib/collab-session.ts");
        expect(file.startsWith("lib/offline/")).toBe(false);
        expect(file.startsWith("components/")).toBe(false);
      }
      for (const name of packages) {
        expect(name).not.toBe("react");
        expect(name.startsWith("@tiptap/")).toBe(false);
        expect(name.startsWith("@hocuspocus/")).toBe(false);
      }
    });
  }
});

describe("import boundaries", () => {
  for (const entry of SERVER_ENTRIES) {
    it(`${entry} imports neither the client tab API nor @hocuspocus/provider`, () => {
      const { files, packages } = staticImports(entry);
      expect([...files]).not.toContain("lib/tab-api.ts");
      expect([...packages]).not.toContain("@hocuspocus/provider");
    });
  }
});

// P2.12 has no line in the editor-chunk ledger (details spec §1 rule 5), so
// block move and the Markdown parser stay out of the editor's static graph:
// whatever wires them in must load them lazily.
const EDITOR_ENTRY = "components/document-editor/document-editor.tsx";

describe("editor chunk boundary (P2.12)", () => {
  it(`${EDITOR_ENTRY} statically loads neither block move nor lib/markdown`, () => {
    const { files } = staticImports(EDITOR_ENTRY);
    // The walk reaches the editor's extensions (it is not vacuous).
    expect(files).toContain(
      "components/document-editor/document-editor-config.ts",
    );
    expect(files).toContain("extensions/title-document/title-document.ts");
    for (const file of files) {
      expect(file.startsWith("extensions/block-move/")).toBe(false);
      expect(file.startsWith("lib/markdown/")).toBe(false);
    }
  });

  it("lib/markdown/parse.ts loads no DOM, React or editor code (IM1's worker)", () => {
    const { files, packages } = staticImports("lib/markdown/parse.ts");
    expect([...files]).toEqual(["lib/markdown/parse.ts"]);
    expect([...packages].sort()).toEqual(["@tiptap/pm/model"]);
  });
});
