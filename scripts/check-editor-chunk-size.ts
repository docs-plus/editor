/**
 * Editor bundle gate (spec §7, contract §5.1): the lazy editor chunk group
 * may grow by at most `EDITOR_CHUNK_BUDGET_BYTES` gzipped over the baseline
 * measured on `58a9d22` (the `integrate/smart-toolbar-ab` tip, before any
 * smart-toolbar v1 track merged).
 *
 * The editor is a `next/dynamic` import (`components/editor-app`). Turbopack
 * emits a loader that fetches the editor's chunk group with
 * `Promise.all([...chunk paths])`; this script finds the chunk holding the
 * editor (by a string only `document-editor.tsx` contains), then the loader
 * array that lists it, and sums every file in that group, gzipped. Lazy
 * chunks the editor loads later (colour popover, Mermaid, lowlight) are
 * not in the group and do not count.
 *
 * Usage: `bun scripts/check-editor-chunk-size.ts [--dir .next]` after
 * `bun run build`. Exits 1 when over budget or when the chunk is not found.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Gzipped bytes of the editor chunk group at `58a9d22`. */
export const EDITOR_CHUNK_BASELINE_BYTES = 377_888;
/** Allowed growth for the whole smart toolbar v1 (spec §7: +6 KB gz). */
export const EDITOR_CHUNK_BUDGET_BYTES = 6 * 1024;

/** Only `document-editor.tsx` renders this string. */
const EDITOR_MARKER = "Main content area, start typing to enter text.";
const LOADER_ARRAY = /Promise\.all\(\[([^\]]*)\]/g;
const CHUNK_PATH = /"(static\/chunks\/[^"]+)"/g;

export interface EditorChunkReport {
  files: string[];
  gzipBytes: number;
}

const gzipSize = (path: string) =>
  Bun.gzipSync(new Uint8Array(readFileSync(path))).byteLength;

/** Measures the editor chunk group of a `next build` output directory. */
export function measureEditorChunk(nextDir: string): EditorChunkReport {
  const chunksDir = join(nextDir, "static", "chunks");
  const scripts = readdirSync(chunksDir).filter((name) => name.endsWith(".js"));
  const sources = new Map(
    scripts.map((name) => [name, readFileSync(join(chunksDir, name), "utf8")]),
  );
  const editor = scripts.find((name) =>
    sources.get(name)?.includes(EDITOR_MARKER),
  );
  if (!editor) throw new Error(`No chunk contains "${EDITOR_MARKER}".`);

  const editorPath = `static/chunks/${editor}`;
  let group = [editorPath];
  for (const source of sources.values()) {
    for (const [, list] of source.matchAll(LOADER_ARRAY)) {
      const paths = [...list.matchAll(CHUNK_PATH)].map((match) => match[1]);
      if (paths.includes(editorPath)) group = paths;
    }
  }
  const gzipBytes = group.reduce(
    (total, path) => total + gzipSize(join(nextDir, path)),
    0,
  );
  return { files: group, gzipBytes };
}

function main() {
  const dirFlag = process.argv.indexOf("--dir");
  const nextDir = dirFlag === -1 ? ".next" : process.argv[dirFlag + 1];
  const { files, gzipBytes } = measureEditorChunk(nextDir);
  const growth = gzipBytes - EDITOR_CHUNK_BASELINE_BYTES;
  const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
  console.log(
    `Editor chunk group (${files.length} files): ${kb(gzipBytes)} gz`,
  );
  for (const file of files) console.log(`  ${file}`);
  console.log(
    `Baseline ${kb(EDITOR_CHUNK_BASELINE_BYTES)}, growth ${growth >= 0 ? "+" : ""}${kb(growth)}, budget +${kb(EDITOR_CHUNK_BUDGET_BYTES)}`,
  );
  if (growth > EDITOR_CHUNK_BUDGET_BYTES) {
    console.error(
      "Editor chunk is over budget. Lazy-load the new surface or trim it.",
    );
    process.exit(1);
  }
}

if (import.meta.main) main();
