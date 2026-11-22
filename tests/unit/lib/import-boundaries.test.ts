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
  "lib/platform/memory-blob-store.ts",
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

// The image store (spec §9, A1): the editor chunk holds only the host-src
// check and the §6.2 fallback's routing. The resolver, the object-URL cache, the strippers,
// sniffing, hashing and the insert pipeline stay lazy chunks.
const LAZY_ASSET_MODULES = [
  "lib/assets/asset-ref.ts",
  "lib/assets/asset-resolver.ts",
  "lib/assets/object-url-cache.ts",
  "lib/assets/strip-metadata.ts",
  "lib/assets/sniff.ts",
  "lib/assets/hash.ts",
  "lib/assets/prepare-image-asset.ts",
  "lib/assets/encode-client.ts",
  "lib/assets/encode-image.ts",
  "extensions/hyper-multimedia/alt-text-popover.ts",
  "extensions/hyper-multimedia/asset-media-actions.ts",
  "extensions/hyper-multimedia/asset-image-view.ts",
  "extensions/hyper-multimedia/asset-image-lazy.ts",
];

// Asset modules the Hocus server and the storage worker may import: no DOM,
// React, editor or platform code.
const SERVER_SAFE_ASSET_MODULES = [
  "lib/assets/asset-ref.ts",
  "lib/assets/limits.ts",
  "lib/assets/sniff.ts",
  "lib/assets/hash.ts",
  "lib/assets/strip-metadata.ts",
];

describe("image store import boundaries", () => {
  it("the media kit loads no lazy asset module eagerly", () => {
    const { files } = staticImports(
      "extensions/hyper-multimedia/hyper-multimedia-kit.ts",
    );
    for (const lazy of LAZY_ASSET_MODULES)
      expect([...files]).not.toContain(lazy);
  });

  for (const entry of SERVER_SAFE_ASSET_MODULES) {
    it(`${entry} imports only other asset modules`, () => {
      const { files, packages } = staticImports(entry);
      expect([...packages]).toEqual([]);
      for (const file of files)
        expect(file.startsWith("lib/assets/")).toBe(true);
    });
  }
});
