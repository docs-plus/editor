/**
 * `library.lock` (architecture §5.4 `open.ts`): one process opens a library
 * at a time. The file holds the owner's pid; a lock whose pid is no longer
 * running is stale (a crash or a SIGKILL) and is taken over. Electron's
 * single-instance lock covers the usual case; this one also covers a second
 * build (internal and release side by side) pointed at the same folder.
 */
import { StorageError } from "./errors";
import type { StorageHost } from "./host";

export const LOCK_FILE = "library.lock";

export function acquireLock(host: StorageHost, dir: string): string {
  const path = host.join(dir, LOCK_FILE);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (host.createExclusive(path, String(host.pid))) return path;
    const holder = Number.parseInt(host.readText(path) ?? "", 10);
    if (
      Number.isInteger(holder) &&
      holder > 0 &&
      holder !== host.pid &&
      host.isPidAlive(holder)
    ) {
      throw new StorageError("locked_elsewhere", `library held by ${holder}`);
    }
    // Stale (dead pid, unreadable, or our own from a restarted worker).
    host.remove(path);
  }
  throw new StorageError("locked_elsewhere", "could not take library.lock");
}

export function releaseLock(host: StorageHost, path: string) {
  if (host.readText(path) === String(host.pid)) host.remove(path);
}
