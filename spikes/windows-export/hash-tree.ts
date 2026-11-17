/**
 * Spike (#103, option (a)): a sha256 manifest of a directory tree, with
 * POSIX separators and sorted paths, so a renderer built on Linux can be
 * compared byte for byte after it is downloaded on Windows or macOS.
 *
 * Usage: bun spikes/windows-export/hash-tree.ts <dir> > manifest.sha256
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";

const dir = resolve(process.argv[2] ?? "out");
const files = (
  readdirSync(dir, { recursive: true, withFileTypes: true }) as {
    name: string;
    parentPath: string;
    isFile(): boolean;
  }[]
)
  .filter((e) => e.isFile())
  .map((e) => join(e.parentPath, e.name).slice(dir.length + 1))
  .map((rel) => rel.split(sep).join("/"))
  .sort();

for (const rel of files) {
  const hash = new Bun.CryptoHasher("sha256")
    .update(readFileSync(join(dir, rel)))
    .digest("hex");
  console.log(`${hash}  ${rel}`);
}
