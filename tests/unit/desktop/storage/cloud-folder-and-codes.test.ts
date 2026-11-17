import { describe, expect, test } from "bun:test";

import { cloudFolderOf } from "@/desktop/storage/engine/cloud-folder";
import { STORED_ORIGINS } from "@/desktop/storage/engine/content";
import { storageErrorFrom } from "@/desktop/storage/engine/driver";
import { STORAGE_ERROR_CODES } from "@/desktop/storage/engine/errors";
import {
  DOC_STORE_ERROR_CODES,
  UPDATE_ORIGINS,
} from "@/lib/platform/doc-store";

const host = (
  platform: string,
  env: Record<string, string> = {},
  homeDir = "",
) => ({
  platform,
  env,
  homeDir,
  realpath: (path: string) => path,
});

describe("cloudFolderOf", () => {
  test("a user name that looks like a provider is not a sync folder", () => {
    expect(
      cloudFolderOf(
        "/home/box/.config/TinyDocy",
        host("linux", {}, "/home/box"),
      ),
    ).toBeNull();
    expect(
      cloudFolderOf(
        "/Users/dropbox/Library/Application Support/TinyDocy",
        host("darwin", {}, "/Users/dropbox"),
      ),
    ).toBeNull();
    expect(
      cloudFolderOf("/home/box/Dropbox/T", host("linux", {}, "/home/box")),
    ).toBe("dropbox");
    expect(
      cloudFolderOf("D:\\Dropbox\\TinyDocy", host("win32", {}, "C:\\Users\\a")),
    ).toBe("dropbox");
  });

  const cases: [string, string, Record<string, string>, string | null][] = [
    ["darwin", "/Users/a/Library/Application Support/TinyDocy", {}, null],
    [
      "darwin",
      "/Users/a/Library/Mobile Documents/com~apple~CloudDocs/T",
      {},
      "icloud",
    ],
    [
      "darwin",
      "/Users/a/Library/CloudStorage/OneDrive-Contoso/T",
      {},
      "onedrive",
    ],
    [
      "darwin",
      "/Users/a/Library/CloudStorage/GoogleDrive-a@b.c/My Drive/T",
      {},
      "google_drive",
    ],
    ["darwin", "/Users/a/Library/CloudStorage/SomethingNew/T", {}, "other"],
    ["darwin", "/Users/a/Dropbox/T", {}, "dropbox"],
    ["linux", "/home/a/.config/TinyDocy", {}, null],
    ["linux", "/home/a/Dropbox (Personal)/T", {}, "dropbox"],
    ["win32", "C:\\Users\\a\\AppData\\Local\\TinyDocy", {}, null],
    [
      "win32",
      "C:\\Users\\a\\Work Files\\TinyDocy",
      { OneDriveCommercial: "c:\\users\\a\\work files" },
      "onedrive",
    ],
    ["win32", "C:\\Users\\a\\OneDrive - Contoso\\T", {}, "onedrive"],
    ["win32", "C:\\Users\\a\\iCloudDrive\\T", {}, "icloud"],
    ["win32", "D:\\OneDriveBackup\\T", {}, null],
  ];
  for (const [platform, path, env, expected] of cases)
    test(`${platform} ${path} → ${expected}`, () => {
      expect(cloudFolderOf(path, host(platform, env))).toBe(expected as never);
    });
});

describe("codes and origins stay in step with the DocStore port", () => {
  test("every DocStore code but the web library's is a storage code", () => {
    const storage = new Set<string>(STORAGE_ERROR_CODES);
    const missing = DOC_STORE_ERROR_CODES.filter(
      (code) =>
        !storage.has(code) &&
        code !== "quota_exceeded" &&
        code !== "build_mismatch",
    );
    expect(missing).toEqual([]);
  });

  test("stored origins match UPDATE_ORIGINS", () => {
    expect([...STORED_ORIGINS]).toEqual([...UPDATE_ORIGINS]);
  });
});

describe("storageErrorFrom", () => {
  const nodeError = (errcode: number) =>
    Object.assign(new Error("x"), { errcode });
  test.each([
    [13, "disk_full"],
    [11, "corrupt"],
    [26, "corrupt"],
    [19 | (8 << 8), "invalid_argument"],
    [5, "locked_elsewhere"],
    [8, "library_read_only"],
    [10 | (12 << 8), "io_error"],
  ])("SQLite %i → %s", (code, expected) => {
    expect(storageErrorFrom(nodeError(code)).code).toBe(expected as never);
  });
});
