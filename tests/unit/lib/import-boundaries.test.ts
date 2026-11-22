import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../..");
const transpiler = new Bun.Transpiler({ loader: "tsx" });

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
    if (seen.has(file)) return;
    seen.add(file);
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

// The headless schema and Markdown export/import (plan P2.8): shared by
// desktop, the web library (W7) and the import engine (IM1), and run in
// workers, so it must not load the editor shell, React, the collaboration
// stack, DOM-only sanitisers or the lowlight registry.
const HEADLESS_ENTRIES = [
  "lib/headless/headless-schema.ts",
  "lib/headless/markdown-export.ts",
  "lib/headless/markdown-import.ts",
  "lib/filenames.ts",
];

const HEADLESS_FORBIDDEN_PACKAGES = new Set([
  "react",
  "react-dom",
  "@tiptap/react",
  "@hocuspocus/provider",
  "dompurify",
  "lowlight",
  "@docs.plus/extension-mermaid",
  "@tiptap/extension-code-block-lowlight",
]);

describe("headless import boundaries", () => {
  for (const entry of HEADLESS_ENTRIES) {
    it(`${entry} loads no editor shell, React or collaboration code`, () => {
      const { files, packages } = staticImports(entry);
      for (const file of files) {
        expect(file.startsWith("components/")).toBe(false);
        expect(file.startsWith("lib/offline/")).toBe(false);
        expect(file).not.toBe("lib/collab-session.ts");
        expect(file).not.toBe("lib/lowlight.ts");
      }
      for (const name of packages) {
        expect(HEADLESS_FORBIDDEN_PACKAGES.has(name)).toBe(false);
        expect(name.startsWith("@hocuspocus/")).toBe(false);
      }
    });
  }
});

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
