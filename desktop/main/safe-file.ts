/**
 * The protocol handler never serves through a symlink (SEC-009). A file in
 * the renderer folder is served only if it is a regular file (`lstat`, so
 * a link is not followed) and its real path is the same path under the
 * folder's real path: a symlink anywhere below the root changes the real
 * path, and a link that escapes the folder fails the containment check.
 *
 * Electron's `fs` reads inside `app.asar` too, so this works packaged.
 */
import { lstatSync, realpathSync } from "node:fs";
import { join, sep } from "node:path";

export type SafeFileFs = {
  lstat: (path: string) => { isFile(): boolean; isSymbolicLink(): boolean };
  realpath: (path: string) => string;
};

const nodeFs: SafeFileFs = {
  lstat: (path) => lstatSync(path),
  realpath: (path) => realpathSync(path),
};

/**
 * Returns `isFile(rel)` for `resolveExportFile`: true only for a regular,
 * non-linked file whose real path stays under `root`.
 */
export function safeFileCheck(
  root: string,
  fs: SafeFileFs = nodeFs,
): (rel: string) => boolean {
  let realRoot: string | null = null;
  return (rel) => {
    try {
      realRoot ??= fs.realpath(root);
      const path = join(root, rel);
      const stat = fs.lstat(path);
      if (stat.isSymbolicLink() || !stat.isFile()) return false;
      const real = fs.realpath(path);
      return real.startsWith(realRoot + sep) && real === join(realRoot, rel);
    } catch {
      return false;
    }
  };
}
