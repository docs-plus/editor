import { afterEach, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  symlinksUnder,
  TEST_HOOK_MARKERS,
  testHookMarkersIn,
} from "@/desktop/build/bundle-checks";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

test("finds every test-hook marker a bundle still holds", () => {
  expect(testHookMarkersIn("var testHooks = null;")).toEqual([]);
  const leaked = `process.env.TINYDOCY_USER_DATA; globalThis.__tinydocyDiagnostics = d;`;
  expect(testHookMarkersIn(leaked)).toEqual([
    "TINYDOCY_USER_DATA",
    "__tinydocyDiagnostics",
  ]);
  expect(testHookMarkersIn(TEST_HOOK_MARKERS.join(" "))).toEqual([
    ...TEST_HOOK_MARKERS,
  ]);
});

test("lists symbolic links under a folder without following them", () => {
  const root = mkdtempSync(join(tmpdir(), "tinydocy-links-"));
  dirs.push(root);
  const outside = mkdtempSync(join(tmpdir(), "tinydocy-outside-"));
  dirs.push(outside);
  mkdirSync(join(root, "_next/static"), { recursive: true });
  writeFileSync(join(root, "index.html"), "<html></html>");
  writeFileSync(join(outside, "secret.txt"), "x");
  expect(symlinksUnder(root)).toEqual([]);

  symlinkSync(join(outside, "secret.txt"), join(root, "_next/static/a.js"));
  symlinkSync(outside, join(root, "escape"), "dir");
  expect(symlinksUnder(root)).toEqual(["_next/static/a.js", "escape"]);
});
