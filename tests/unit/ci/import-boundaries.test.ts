/**
 * Import boundaries (desktop architecture §3.3). Imports are read with
 * `Bun.Transpiler().scanImports()` (type-only imports are dropped, as at
 * runtime) and followed transitively through relative and `@/` paths.
 *
 * Rows checked so far: the storage engine, the storage worker, main,
 * the preload, `desktop/shared` and `lib/platform/desktop`. The renderer
 * rows come with DesktopRoot (P2.4b).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const transpilers = {
  ts: new Bun.Transpiler({ loader: "ts" }),
  tsx: new Bun.Transpiler({ loader: "tsx" }),
};

function filesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...filesUnder(path));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith(".d.ts")) out.push(path);
  }
  return out;
}

function resolveLocal(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(ROOT, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ])
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  throw new Error(`cannot resolve ${specifier} from ${relative(ROOT, from)}`);
}

/** Every module `entry` reaches at runtime: local files and bare specifiers. */
function reach(entries: string[]): {
  files: Set<string>;
  bare: Map<string, string>;
} {
  const files = new Set<string>();
  const bare = new Map<string, string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (files.has(file)) continue;
    files.add(file);
    const transpiler = file.endsWith(".tsx") ? transpilers.tsx : transpilers.ts;
    for (const { path } of transpiler.scanImports(readFileSync(file, "utf8"))) {
      const local = resolveLocal(file, path);
      if (local) queue.push(local);
      else if (!bare.has(path)) bare.set(path, relative(ROOT, file));
    }
  }
  return { files, bare };
}

const rel = (path: string) => relative(ROOT, path).split("\\").join("/");

describe("desktop/storage/engine", () => {
  const { files, bare } = reach(
    filesUnder(join(ROOT, "desktop/storage/engine")),
  );

  test("imports no electron, node:*, bun:*, React or Tiptap", () => {
    const banned = [...bare.entries()].filter(
      ([spec]) =>
        /^(electron|node:|bun:|react|react-dom|@tiptap\/)/.test(spec) ||
        /^(fs|path|os|worker_threads|child_process)$/.test(spec),
    );
    expect(banned).toEqual([]);
  });

  test("stays inside desktop/storage/engine", () => {
    const outside = [...files]
      .map(rel)
      .filter((file) => !file.startsWith("desktop/storage/engine/"));
    expect(outside).toEqual([]);
  });
});

// Architecture §3.3: main and storage may reach only these parts of lib/.
const LIB_ALLOWED = [
  /^lib\/security\/content-security-policy\.ts$/,
  // Its one import: the GA host lists, pure constants.
  /^lib\/analytics-config\.ts$/,
  /^lib\/doc-migrations\//,
  /^lib\/prefs\/schema\.ts$/,
  /^lib\/comments\/validate\.ts$/,
  /^lib\/assets\//,
  // Pure name lists the import guard checks against (amended in §3.3).
  /^lib\/schema-names\.ts$/,
];

describe("desktop/storage", () => {
  test("reaches lib/ only through the allowlist, and never React", () => {
    const { files, bare } = reach(filesUnder(join(ROOT, "desktop/storage")));
    const libFiles = [...files]
      .map(rel)
      .filter((file) => file.startsWith("lib/"))
      .filter((file) => !LIB_ALLOWED.some((pattern) => pattern.test(file)));
    expect(libFiles).toEqual([]);
    expect([...bare.keys()].filter((spec) => /^react/.test(spec))).toEqual([]);
  });

  test("never imports bun:* (it runs inside Electron)", () => {
    const { bare } = reach(filesUnder(join(ROOT, "desktop/storage")));
    expect([...bare.keys()].filter((spec) => spec.startsWith("bun:"))).toEqual(
      [],
    );
  });
});

describe("lib/platform/desktop", () => {
  test("never imports desktop/main, preload or storage", () => {
    const { files } = reach(filesUnder(join(ROOT, "lib/platform/desktop")));
    const crossing = [...files]
      .map(rel)
      .filter((file) => /^desktop\/(main|preload|storage)\//.test(file));
    expect(crossing).toEqual([]);
  });
});

describe("desktop/main", () => {
  const { files, bare } = reach(filesUnder(join(ROOT, "desktop/main")));

  test("reaches lib/ only through the allowlist, and never React or bun:*", () => {
    const libFiles = [...files]
      .map(rel)
      .filter((file) => file.startsWith("lib/"))
      .filter((file) => !LIB_ALLOWED.some((pattern) => pattern.test(file)));
    expect(libFiles).toEqual([]);
    expect(
      [...bare.keys()].filter((spec) => /^(react|bun:|@tiptap\/)/.test(spec)),
    ).toEqual([]);
  });

  test("never imports the renderer's code", () => {
    const renderer = [...files]
      .map(rel)
      .filter((file) => /^(app|components|hooks)\//.test(file));
    expect(renderer).toEqual([]);
  });
});

describe("desktop/preload", () => {
  const { files, bare } = reach(filesUnder(join(ROOT, "desktop/preload")));

  test("imports only desktop/shared and electron", () => {
    const outside = [...files]
      .map(rel)
      .filter((file) => !/^desktop\/(preload|shared)\//.test(file));
    expect(outside).toEqual([]);
    expect([...bare.keys()]).toEqual(["electron"]);
  });
});

describe("desktop/shared", () => {
  test("imports nothing outside itself", () => {
    const { files, bare } = reach(filesUnder(join(ROOT, "desktop/shared")));
    const outside = [...files]
      .map(rel)
      .filter((file) => !file.startsWith("desktop/shared/"));
    expect(outside).toEqual([]);
    expect([...bare.keys()]).toEqual([]);
  });
});
