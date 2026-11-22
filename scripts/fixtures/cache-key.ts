/**
 * The CI cache key for generated fixtures (test strategy §3.1: "CI caches
 * them, keyed by a hash of the generator's source"). It covers the
 * generators, the helpers they extend, the storage engine that writes the
 * libraries, the editor schema snapshot and the lockfile (Yjs and the
 * editor extensions shape the stored bytes).
 *
 * A workflow step restores with `bun scripts/fixtures/generate.ts
 * --cache-key` as the `actions/cache` key; no workflow uses it yet.
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const FIXTURE_SOURCES: readonly string[] = [
  "scripts/fixtures",
  "tests/helpers/document-generators.ts",
  "tests/helpers/image-bytes.ts",
  "tests/helpers/editor-schema.ts",
  "tests/helpers/storage-library.ts",
  "tests/fixtures/schema-snapshot.json",
  "desktop/storage/engine",
  "lib/doc-migrations/index.ts",
  "bun.lock",
];

function listFiles(root: string, path: string): string[] {
  const full = join(root, path);
  if (!statSync(full).isDirectory()) return [path];
  return readdirSync(full)
    .flatMap((name) => listFiles(root, relative(root, join(full, name))))
    .filter((file) => !file.includes("node_modules"));
}

/** `fixtures-<16 hex>`: changes whenever any source above changes. */
export function fixtureCacheKey(
  root: string,
  sources: readonly string[] = FIXTURE_SOURCES,
): string {
  const files = sources.flatMap((source) => listFiles(root, source)).sort();
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(`${file.split("\\").join("/")}\0`);
    hash.update(readFileSync(join(root, file)));
    hash.update("\0");
  }
  return `fixtures-${hash.digest("hex").slice(0, 16)}`;
}
