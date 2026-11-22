/**
 * Every package that runs Electron pins the same exact version, so the
 * D-A12 smoke, the storage soak and the shell test the Electron that ships
 * (desktop/build/electron-builder.yml `electronVersion`).
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const pinOf = (file: string) =>
  JSON.parse(readFileSync(join(ROOT, file), "utf8")).devDependencies
    ?.electron as string | undefined;

test("one exact Electron version everywhere", () => {
  const builder = readFileSync(
    join(ROOT, "desktop/build/electron-builder.yml"),
    "utf8",
  );
  const shipped = /^electronVersion:\s*(\S+)$/m.exec(builder)?.[1];
  expect(shipped).toMatch(/^\d+\.\d+\.\d+$/);
  for (const file of [
    "package.json",
    "desktop/smoke/package.json",
    "desktop/storage-harness/package.json",
  ])
    expect({ file, pin: pinOf(file) }).toEqual({ file, pin: shipped });
});
