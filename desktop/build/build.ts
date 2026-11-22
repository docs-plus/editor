/**
 * Builds the desktop app folder (desktop architecture §3.1 steps 2–3):
 *
 *   bun run build:desktop        # the renderer, into out/ (Linux in CI, #103)
 *   bun desktop/build/build.ts [--flavor release|test]   # into dist/desktop-app/
 *
 * 1. Bundles `main.cjs`, `preload.cjs` and `worker.cjs` (and
 *    `copy-worker.cjs` once #128 adds it) with `Bun.build`: CJS, `node:*` and
 *    `electron` external. CJS because a sandboxed preload must be CJS (S1).
 * 2. Checks them: the preload requires only `electron`; main and the
 *    workers require no `bun:*` module and no React.
 * 3. Stages `dist/desktop-app/`: a `package.json` with only what
 *    electron-builder reads, the bundles, and `renderer/` copied from
 *    `out/`. A renderer exported on Windows (`__next.*` directories, #103)
 *    or one that fails the export checks is refused.
 *
 * Build-time values (inlined with `define`):
 * - `__TINYDOCY_IPC_BUILD__`: the git SHA (`GITHUB_SHA`, else `git rev-parse`).
 * - `TINYDOCY_SYNC_URL`: the default sync server for `connect-src`; the
 *   same `NEXT_PUBLIC_HOCUS_URL` the renderer was exported with.
 * - `TINYDOCY_RUNTIME_STYLE_HASHES`: Tiptap's injected stylesheet.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";

import { checkDesktopExport } from "../../scripts/desktop-export";
import { sha256Source } from "../main/csp";
import { type Flavor, validateSyncUrl } from "./sync-url";
import { tiptapStyleText } from "./tiptap-style";

const ROOT = join(import.meta.dir, "../..");
const OUT = join(ROOT, "out");
const STAGE = join(ROOT, "dist/desktop-app");

function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  const result = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: ROOT });
  return result.success ? result.stdout.toString().trim() : "dev";
}

const rootPackage = JSON.parse(
  readFileSync(join(ROOT, "package.json"), "utf8"),
);
/**
 * `--flavor release` (the default) compiles the test hooks out
 * (`desktop/main/test-hooks.ts`, SEC-006) and requires a `wss:` sync URL;
 * `--flavor test` keeps them, for the electron specs.
 */
const flavorArg = process.argv.indexOf("--flavor");
const FLAVOR: Flavor =
  flavorArg > 0 && process.argv[flavorArg + 1] === "test" ? "test" : "release";

const define = {
  __TINYDOCY_IPC_BUILD__: JSON.stringify(gitSha()),
  __TINYDOCY_TEST_HOOKS__: FLAVOR === "test" ? "true" : "false",
  "process.env.TINYDOCY_SYNC_URL": JSON.stringify(
    validateSyncUrl(
      process.env.NEXT_PUBLIC_HOCUS_URL?.trim() || "ws://127.0.0.1:1234",
      FLAVOR,
    ),
  ),
  "process.env.TINYDOCY_RUNTIME_STYLE_HASHES": JSON.stringify(
    JSON.stringify([sha256Source(tiptapStyleText(ROOT))]),
  ),
};

async function bundle(entry: string, name: string): Promise<string> {
  const result = await Bun.build({
    entrypoints: [join(ROOT, entry)],
    target: "node",
    format: "cjs",
    external: ["electron"],
    define,
    minify: { syntax: true, whitespace: false, identifiers: false },
  });
  if (!result.success) {
    for (const log of result.logs) console.error(log);
    throw new Error(`bundling ${entry} failed`);
  }
  const code = await result.outputs[0].text();
  writeFileSync(join(STAGE, name), code);
  return code;
}

const requiresOf = (code: string) =>
  new Set([...code.matchAll(/require\(["']([^"']+)["']\)/g)].map((m) => m[1]));

function check(name: string, code: string, preload: boolean): string[] {
  const problems: string[] = [];
  const requires = requiresOf(code);
  if (preload) {
    const foreign = [...requires].filter((r) => r !== "electron");
    if (foreign.length > 0)
      problems.push(`${name} requires ${foreign.join(", ")} (only electron)`);
  }
  for (const r of requires) {
    if (r.startsWith("bun:")) problems.push(`${name} requires ${r}`);
    if (/^react(-dom)?(\/|$)/.test(r)) problems.push(`${name} requires ${r}`);
  }
  if (/\breact-dom\b|__SECRET_INTERNALS|ReactCurrentOwner/.test(code))
    problems.push(`${name} contains React`);
  if (code.includes(ROOT)) problems.push(`${name} embeds the build path`);
  return problems;
}

async function main(): Promise<number> {
  if (!existsSync(join(OUT, "index.html"))) {
    console.error(
      "[desktop-build] out/ has no renderer: run `bun run build:desktop` first",
    );
    return 1;
  }
  const exportProblems = checkDesktopExport(OUT);
  for (const problem of exportProblems)
    console.error(`[desktop-build] ${problem}`);
  if (exportProblems.length > 0) return 1;

  rmSync(STAGE, { recursive: true, force: true });
  mkdirSync(STAGE, { recursive: true });

  const entries: Array<[string, string, boolean]> = [
    ["desktop/main/index.ts", "main.cjs", false],
    ["desktop/preload/index.ts", "preload.cjs", true],
    ["desktop/storage/worker.ts", "worker.cjs", false],
  ];
  if (existsSync(join(ROOT, "desktop/storage/copy-worker.ts")))
    entries.push(["desktop/storage/copy-worker.ts", "copy-worker.cjs", false]);

  const problems: string[] = [];
  for (const [entry, name, preload] of entries) {
    const code = await bundle(entry, name);
    problems.push(...check(name, code, preload));
    console.log(
      `[desktop-build] ${name} ${(code.length / 1024).toFixed(1)} KiB`,
    );
  }
  for (const problem of problems) console.error(`[desktop-build] ${problem}`);
  if (problems.length > 0) return 1;

  writeFileSync(
    join(STAGE, "package.json"),
    `${JSON.stringify(
      {
        name: "tinydocy",
        productName: "TinyDocy",
        version: rootPackage.version,
        description: "TinyDocy, by docs.plus",
        author: { name: "docs.plus", email: "hello@docs.plus" },
        homepage: "https://tiny.docs.plus",
        license: rootPackage.license,
        // Electron takes the X11 WM_CLASS and Wayland app_id from this (S3).
        desktopName: "TinyDocy.desktop",
        main: "main.cjs",
      },
      null,
      2,
    )}\n`,
  );
  cpSync(OUT, join(STAGE, "renderer"), { recursive: true });
  console.log(`[desktop-build] staged ${relative(ROOT, STAGE)} (${FLAVOR})`);
  return 0;
}

process.exit(await main());
