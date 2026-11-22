/**
 * SEC-001: the shipped build's fuses, pinned in electron-builder.yml. The
 * inspect fuse is off; only the unpacked test flavour turns it on, on the
 * command line (`-c.electronFuses.enableNodeCliInspectArguments=true`).
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const yml = readFileSync(
  join(
    resolve(import.meta.dir, "../../../.."),
    "desktop/build/electron-builder.yml",
  ),
  "utf8",
);
const fuse = (name: string) =>
  new RegExp(`^\\s+${name}:\\s*(true|false)\\s*$`, "m").exec(yml)?.[1];

test("the release fuses are pinned off and on as the plan requires", () => {
  expect(fuse("enableNodeCliInspectArguments")).toBe("false");
  expect(fuse("runAsNode")).toBe("false");
  expect(fuse("enableNodeOptionsEnvironmentVariable")).toBe("false");
  expect(fuse("enableCookieEncryption")).toBe("true");
  expect(fuse("enableEmbeddedAsarIntegrityValidation")).toBe("true");
  expect(fuse("onlyLoadAppFromAsar")).toBe("true");
  expect(fuse("grantFileProtocolExtraPrivileges")).toBe("false");
});
