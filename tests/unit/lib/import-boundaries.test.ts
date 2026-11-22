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

/**
 * Known path, left to P2.2's folder: `document-editor.tsx` imports
 * `CollabStatusGroup` statically, and its connection status reads
 * collab-session's unsynced-changes state. It renders only with a provider,
 * so lazy-loading it there removes this last path.
 */
const KNOWN_PATHS = ["components/tiptap-ui/user-identity-button.tsx"];

describe("editor import boundaries", () => {
  for (const entry of EDITOR_ENTRIES) {
    it(`${entry} loads no collab-session or platform adapter`, () => {
      const { files } = staticImports(entry, KNOWN_PATHS);
      for (const file of files) {
        expect(file).not.toBe("lib/collab-session.ts");
        expect(file.startsWith("lib/platform/web/")).toBe(false);
        expect(file.startsWith("lib/platform/desktop/")).toBe(false);
        // Document links (search-linking §4.1, D23): the editor passes the
        // host's link options through and imports only their type.
        expect(file.startsWith("lib/links/")).toBe(false);
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
