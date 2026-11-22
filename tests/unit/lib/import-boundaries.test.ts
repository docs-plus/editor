import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../..");
const tsx = new Bun.Transpiler({ loader: "tsx" });
const ts = new Bun.Transpiler({ loader: "ts" });

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
    // `.ts` files may hold generic arrows that only parse as TypeScript.
    const transpiler = file.endsWith(".tsx") ? tsx : ts;
    const { imports } = transpiler.scan(readFileSync(file, "utf8"));
    for (const { path: spec, kind } of imports) {
      if (kind !== "import-statement") continue;
      if (spec.startsWith("@/") || spec.startsWith(".")) {
        const resolved = Bun.resolveSync(spec, path.dirname(file));
        // Only scripts carry imports (stylesheets, SVGs, JSON don't).
        if (!/\.(?:[cm]?[jt]sx?)$/.test(resolved)) continue;
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

// The library UI (desktop architecture §3.3, web library §7.1, D3): the
// desktop shell and the web library both import it, so it must not load
// the sandbox's collaboration stack or tab list, offline copies,
// analytics, desktop-only code, test helpers, or the editor.
const LIBRARY_ENTRIES = [
  "components/library/library-context.tsx",
  "components/library/library-sidebar.tsx",
  "components/library/library-tree.tsx",
  "components/library/quick-open.tsx",
  "components/library/move-to-dialog.tsx",
  "components/library/item-menu.tsx",
];

const LIBRARY_FORBIDDEN_FILES = [
  "lib/collab-session.ts",
  "hooks/use-synced-tabs.ts",
  "hooks/use-connection-state.ts",
];
const LIBRARY_FORBIDDEN_PREFIXES = [
  "lib/offline/",
  "lib/analytics",
  "lib/platform/desktop/",
  "lib/platform/web/",
  "components/desktop/",
  "components/document-editor/",
  "desktop/",
  "tests/",
];

describe("library UI import boundaries", () => {
  for (const entry of LIBRARY_ENTRIES) {
    it(`${entry} loads no sandbox, desktop, editor or test code`, () => {
      const { files, packages } = staticImports(entry);
      for (const file of files) {
        expect(LIBRARY_FORBIDDEN_FILES).not.toContain(file);
        for (const prefix of LIBRARY_FORBIDDEN_PREFIXES) {
          expect(file.startsWith(prefix)).toBe(false);
        }
      }
      for (const name of packages) {
        expect(name.startsWith("@tiptap/")).toBe(false);
        expect(name.startsWith("@hocuspocus/")).toBe(false);
        expect(name).not.toBe("yjs");
        expect(name).not.toBe("electron");
      }
    });
  }
});

// Document links (search-linking §4.1, D23): the editor chunk passes the
// host's link options through and never loads lib/links itself (types only).
const EDITOR_ENTRIES = [
  "components/document-editor/document-editor.tsx",
  "components/document-editor/document-editor-config.ts",
];

describe("editor import boundaries", () => {
  for (const entry of EDITOR_ENTRIES) {
    it(`${entry} loads no lib/links code`, () => {
      const { files } = staticImports(entry);
      for (const file of files) {
        expect(file.startsWith("lib/links/")).toBe(false);
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
