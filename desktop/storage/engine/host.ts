/**
 * What the engine needs from the operating system, injected so the engine
 * imports no `node:*` or `bun:*` module (desktop architecture §3.3). The
 * worker passes `createNodeHost()` (`desktop/storage/node-host.ts`); tests
 * pass the same host with a fake clock, or a fake pid check.
 */
/** An incremental SHA-256 (the engine can't import `node:crypto`). */
export interface Hasher {
  update(data: Uint8Array | string): Hasher;
  /** Lowercase hex. */
  digest(): string;
}

export interface StorageHost {
  /** `process.platform`. */
  readonly platform: string;
  /** This process's pid, written to `library.lock`. */
  readonly pid: number;
  /** The home folder, used only to recognise cloud-synced folders. */
  readonly homeDir: string;
  /** Environment variables (OneDrive sets `OneDrive*` on Windows). */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Milliseconds since the epoch. */
  now(): number;
  join(...parts: string[]): string;
  /** Resolves symlinks; returns the path unchanged when it doesn't exist. */
  realpath(path: string): string;
  mkdirp(path: string): void;
  exists(path: string): boolean;
  /** File names in `dir`, or `[]` when it doesn't exist. */
  list(dir: string): string[];
  remove(path: string): void;
  rename(from: string, to: string): void;
  readText(path: string): string | null;
  /** Creates `path` with `text`; false when it already exists. */
  createExclusive(path: string, text: string): boolean;
  /** Whether a process with this pid is running. */
  isPidAlive(pid: number): boolean;
  /** A new SHA-256 hasher. Synchronous, so `Library.open` can use it. */
  sha256(): Hasher;
}
