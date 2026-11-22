/**
 * Test helpers for the desktop storage engine on `bun:sqlite`: a temp
 * library folder, a controllable clock, and an opener with test defaults.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openBunSqlite } from "@/desktop/dev/bun-sqlite-driver";
import type { StorageHost } from "@/desktop/storage/engine/host";
import {
  Library,
  type OpenLibraryOptions,
} from "@/desktop/storage/engine/library";
import { createNodeHost } from "@/desktop/storage/node-host";

export type TestClock = { now: number; advance(ms: number): void };

export function createClock(
  start = Date.UTC(2026, 10, 17, 9, 0, 0),
): TestClock {
  return {
    now: start,
    advance(ms) {
      this.now += ms;
    },
  };
}

export function createTempDir(prefix = "tinydocy-lib-"): {
  dir: string;
  cleanUp(): void;
} {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, cleanUp: () => rmSync(dir, { recursive: true, force: true }) };
}

export function createTestHost(
  clock: TestClock,
  overrides: Partial<StorageHost> = {},
): StorageHost {
  return createNodeHost({ now: () => clock.now, ...overrides });
}

export function openTestLibrary(
  dir: string,
  host: StorageHost,
  options: Partial<OpenLibraryOptions> = {},
): Library {
  return Library.open({
    dir,
    host,
    openSqlite: openBunSqlite,
    // Tests don't need F_FULLFSYNC's 4 ms per commit.
    fullfsync: false,
    ...options,
  });
}

/**
 * Simulates a crash: the library is dropped without `shutdown`, so
 * `unclean_exit` stays set and the lock file stays behind. The lock's pid is
 * this test process, which the next open treats as stale.
 */
export function crash(library: Library) {
  (library as unknown as { db: { close(): void } | null }).db?.close();
  (library as unknown as { db: unknown }).db = null;
}

/** A folder that must be created (tests don't expect a refusal). */
export function mustFolder(
  library: Library,
  input: { name: string; parentId?: string | null },
): { id: string; rev: number } {
  const created = library.createFolder(input);
  if (!created) throw new Error(`folder ${input.name} was refused`);
  return created;
}

/** A tag that must be created or found. */
export function mustTag(
  library: Library,
  name: string,
  color: string | null = null,
): { id: string; rev: number } {
  const tag = library.createTag(name, color);
  if (!tag) throw new Error(`tag ${name} was refused`);
  return tag;
}
