/**
 * Refuses a library inside a cloud-synced folder (plan Appendix A, P2.6;
 * architecture §5.4 `open.ts`). A sync client that uploads `library.sqlite`
 * without its `-wal` file, or restores an older copy under a live
 * connection, corrupts the library. `userData` never lives in one by
 * default; this catches a moved home folder, OneDrive Known Folder Move and
 * a `TINYDOCY_USER_DATA` override.
 */
import type { StorageHost } from "./host";

export type CloudProvider =
  | "icloud"
  | "onedrive"
  | "dropbox"
  | "google_drive"
  | "box"
  | "other";

// Folder names sync clients create. Compared case-insensitively against
// every path segment.
const SEGMENTS: ReadonlyArray<[RegExp, CloudProvider]> = [
  [/^mobile documents$/i, "icloud"], // ~/Library/Mobile Documents (iCloud Drive)
  [/^icloud ?drive/i, "icloud"], // Windows iCloud for Windows
  [/^onedrive( |$|-)/i, "onedrive"], // OneDrive, OneDrive - Contoso
  [/^dropbox( |$|\()/i, "dropbox"], // Dropbox, Dropbox (Personal)
  [/^google ?drive/i, "google_drive"],
  [/^my drive$/i, "google_drive"],
  [/^box( |$)/i, "box"],
];

// macOS File Provider puts every modern sync client under
// ~/Library/CloudStorage/<Provider>-<account>.
const CLOUD_STORAGE: ReadonlyArray<[RegExp, CloudProvider]> = [
  [/^onedrive/i, "onedrive"],
  [/^dropbox/i, "dropbox"],
  [/^googledrive/i, "google_drive"],
  [/^box/i, "box"],
  [/^icloud/i, "icloud"],
];

const ONEDRIVE_ENV = ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"];

function segmentsOf(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

function isUnder(path: string, root: string, caseInsensitive: boolean) {
  const a = segmentsOf(path);
  const b = segmentsOf(root);
  if (b.length === 0 || b.length > a.length) return false;
  return b.every((part, i) =>
    caseInsensitive
      ? part.toLowerCase() === a[i]?.toLowerCase()
      : part === a[i],
  );
}

/** The cloud provider syncing `dir`, or null. Symlinks are resolved first. */
export function cloudFolderOf(
  dir: string,
  host: Pick<StorageHost, "platform" | "env" | "realpath">,
): CloudProvider | null {
  const resolved = host.realpath(dir);
  const caseInsensitive = host.platform !== "linux";
  for (const name of ONEDRIVE_ENV) {
    const root = host.env[name];
    if (root && isUnder(resolved, root, caseInsensitive)) return "onedrive";
  }
  const parts = segmentsOf(resolved);
  for (const [i, part] of parts.entries()) {
    if (part.toLowerCase() === "cloudstorage") {
      const next = parts[i + 1] ?? "";
      for (const [pattern, provider] of CLOUD_STORAGE)
        if (pattern.test(next)) return provider;
      return "other";
    }
    for (const [pattern, provider] of SEGMENTS)
      if (pattern.test(part)) return provider;
  }
  return null;
}
