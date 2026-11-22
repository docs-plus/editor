import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dir, "../../..");
const tsx = new Bun.Transpiler({ loader: "tsx" });
const ts = new Bun.Transpiler({ loader: "ts" });
/** Stylesheets and other assets are imported for their side effect only. */
const SCRIPT = /\.[cm]?[jt]sx?$/;

/**
 * Project files and packages reachable from `entry` through static (runtime)
 * imports. Type-only imports are erased by the transpiler; dynamic
 * `import()` is a separate chunk and is not followed.
 */
function staticImports(
  entry: string,
  /** Project files the walk does not enter (a known path, fixed elsewhere). */
  skip: readonly string[] = [],
): {
  files: Set<string>;
  packages: Set<string>;
} {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file) || !SCRIPT.test(file)) return;
    if (skip.includes(path.relative(ROOT, file))) return;
    seen.add(file);
    // `.ts` parsed as TSX misreads generics such as `<T>(x) => x` as JSX.
    const transpiler = file.endsWith("x") ? tsx : ts;
    const { imports } = transpiler.scan(readFileSync(file, "utf8"));
    for (const { path: spec, kind } of imports) {
      if (kind !== "import-statement") continue;
      if (spec.startsWith("@/") || spec.startsWith(".")) {
        const resolved = Bun.resolveSync(spec, path.dirname(file));
        // Stylesheets import nothing the rules care about.
        if (/\.s?css$/.test(resolved)) continue;
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

// The editor reads its DocSession from context (architecture §3.3): neither
// the hook nor the editor may load the sandbox's collab-session or a
// platform adapter, so the desktop graph never contains them.
const EDITOR_ENTRIES = [
  "hooks/use-yjs-document.ts",
  // Every module in the editor's folder, lazy ones included.
  ...readdirSync(path.join(ROOT, "components/document-editor"))
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => `components/document-editor/${name}`),
];

describe("editor import boundaries", () => {
  for (const entry of EDITOR_ENTRIES) {
    it(`${entry} loads no collab-session or platform adapter`, () => {
      const { files } = staticImports(entry);
      for (const file of files) {
        expect(file).not.toBe("lib/collab-session.ts");
        expect(file.startsWith("lib/platform/web/")).toBe(false);
        expect(file.startsWith("lib/platform/desktop/")).toBe(false);
      }
    });
  }
});

// The lazy comments chunk shares no module with the editor chunk (a shared
// one splits the editor group, contract A16): it reaches the editor's
// Yjs, y-tiptap and ProseMirror code only through `CommentsDeps`.
describe("comments chunk boundary", () => {
  it("extensions/comments/comments-controller.ts loads only comments code", () => {
    const { files, packages } = staticImports(
      "extensions/comments/comments-controller.ts",
    );
    for (const file of files) {
      expect(
        file.startsWith("lib/comments/") ||
          file === "extensions/comments/comments-controller.ts",
      ).toBe(true);
    }
    expect([...files]).not.toContain("lib/comments/entry-check.ts");
    expect([...packages]).toEqual([]);
  });
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
