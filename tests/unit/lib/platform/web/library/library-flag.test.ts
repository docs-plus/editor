import { afterEach, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type FlagModule = typeof import("@/lib/platform/web/library/library-flag");

const ROOT = path.resolve(import.meta.dir, "../../../../../..");
const original = process.env.NEXT_PUBLIC_LIBRARY;

afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_LIBRARY;
  else process.env.NEXT_PUBLIC_LIBRARY = original;
  resetModules();
});

async function flagWith(value: string | undefined): Promise<boolean> {
  if (value === undefined) delete process.env.NEXT_PUBLIC_LIBRARY;
  else process.env.NEXT_PUBLIC_LIBRARY = value;
  const { LIBRARY_ENABLED } = await importFresh<FlagModule>(
    "@/lib/platform/web/library/library-flag",
  );
  return LIBRARY_ENABLED;
}

/** Every source file under `dir`, skipping build output and dependencies. */
function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) files.push(...sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(name)) files.push(full);
  }
  return files;
}

describe("NEXT_PUBLIC_LIBRARY (web library §2.8)", () => {
  it("is off by default, so the library lands dark", async () => {
    expect(await flagWith(undefined)).toBe(false);
    expect(await flagWith("")).toBe(false);
    expect(await flagWith("0")).toBe(false);
    expect(await flagWith("true")).toBe(false);
  });

  it("turns on only with 1", async () => {
    expect(await flagWith("1")).toBe(true);
    expect(await flagWith(" 1 ")).toBe(true);
  });

  it("is imported by nothing the web app ships yet (W4 adds the route)", () => {
    const importers = ["app", "components", "hooks", "extensions"]
      .flatMap((dir) => sourceFiles(path.join(ROOT, dir)))
      .filter((file) =>
        readFileSync(file, "utf8").includes("lib/platform/web/library"),
      )
      .map((file) => path.relative(ROOT, file));
    expect(importers).toEqual([]);
  });

  it("never wipes the library: the module deletes nothing", () => {
    const dir = path.join(ROOT, "lib/platform/web/library");
    for (const file of sourceFiles(dir)) {
      expect(readFileSync(file, "utf8")).not.toContain("deleteDatabase");
    }
  });
});
