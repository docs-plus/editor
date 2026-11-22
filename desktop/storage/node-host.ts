/**
 * The `StorageHost` the worker runs with: `node:fs`, `node:os` and
 * `node:path`. Bun implements these modules too, so unit tests use the same
 * host (with `now` or `isPidAlive` overridden where a test needs to).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import type { StorageHost } from "./engine/host";

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === code
  );
}

export function createNodeHost(
  overrides: Partial<StorageHost> = {},
): StorageHost {
  return {
    platform: process.platform,
    pid: process.pid,
    homeDir: homedir(),
    env: process.env,
    now: () => Date.now(),
    join: (...parts) => join(...parts),
    realpath(path) {
      try {
        return realpathSync.native(path);
      } catch {
        return path;
      }
    },
    mkdirp: (path) => {
      mkdirSync(path, { recursive: true });
    },
    exists: (path) => existsSync(path),
    list(dir) {
      try {
        return readdirSync(dir);
      } catch (error) {
        if (isErrno(error, "ENOENT")) return [];
        throw error;
      }
    },
    remove: (path) => rmSync(path, { force: true }),
    rename: (from, to) => renameSync(from, to),
    readText(path) {
      try {
        return readFileSync(path, "utf8");
      } catch (error) {
        if (isErrno(error, "ENOENT")) return null;
        throw error;
      }
    },
    createExclusive(path, text) {
      try {
        writeFileSync(path, text, { flag: "wx" });
        return true;
      } catch (error) {
        if (isErrno(error, "EEXIST")) return false;
        throw error;
      }
    },
    isPidAlive(pid) {
      try {
        process.kill(pid, 0);
        return true;
      } catch (error) {
        // EPERM: it exists but belongs to someone else.
        return isErrno(error, "EPERM");
      }
    },
    ...overrides,
  };
}
