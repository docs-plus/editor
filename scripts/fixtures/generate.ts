/**
 * Seeded fixture generator (test strategy §3.2, Q1).
 *
 *   bun scripts/fixtures/generate.ts --set library-1k --seed 42 --out "$TMP"
 *   bun scripts/fixtures/generate.ts --set doc-rtl,hostile --out "$TMP"
 *   bun scripts/fixtures/generate.ts --all --out "$TMP"
 *   bun scripts/fixtures/generate.ts --list
 *   bun scripts/fixtures/generate.ts --cache-key
 *
 * The seed comes from `--seed`, then `SEED`, then 42, and is printed first:
 * `SEED=<n>` replays a run. Each set lands in `<out>/<set>/` with a
 * `manifest.json`. Large sets are generated at test time into temp folders,
 * never committed (§3.1).
 */
import { resolve } from "node:path";
import { parseArgs } from "node:util";

import { fixtureCacheKey } from "./cache-key";
import { createRng, parseSeed } from "./rng";
import { DEFERRED_SETS, FIXTURE_SETS, findSet, generateSet } from "./sets";

export const DEFAULT_SEED = 42;

const REPO_ROOT = resolve(import.meta.dir, "../..");

function usage(): string {
  return [
    "usage: bun scripts/fixtures/generate.ts (--set <a,b> | --all) --out <dir> [--seed <n>]",
    "       bun scripts/fixtures/generate.ts --list | --cache-key",
  ].join("\n");
}

export function main(
  argv: string[],
  env: Record<string, string | undefined> = process.env,
): number {
  const { values } = parseArgs({
    args: argv,
    options: {
      set: { type: "string" },
      all: { type: "boolean" },
      seed: { type: "string" },
      out: { type: "string" },
      list: { type: "boolean" },
      "cache-key": { type: "boolean" },
    },
    strict: true,
  });

  if (values["cache-key"]) {
    console.log(fixtureCacheKey(REPO_ROOT));
    return 0;
  }
  if (values.list) {
    for (const set of FIXTURE_SETS)
      console.log(`${set.name.padEnd(14)} ${set.contents} (${set.usedBy})`);
    for (const [name, waitsOn] of Object.entries(DEFERRED_SETS))
      console.log(`${name.padEnd(14)} waits on ${waitsOn}`);
    return 0;
  }

  const sets = values.all
    ? FIXTURE_SETS
    : (values.set ?? "")
        .split(",")
        .filter(Boolean)
        .map((name) => findSet(name.trim()));
  if (sets.length === 0 || !values.out) {
    console.error(usage());
    return 2;
  }

  const seed = parseSeed(values.seed ?? env.SEED, DEFAULT_SEED);
  console.log(`seed=${seed}`);
  const rng = createRng(seed);
  for (const set of sets) {
    const started = performance.now();
    const manifest = generateSet(set, resolve(values.out), rng);
    const ms = Math.round(performance.now() - started);
    const what = manifest.library
      ? `${manifest.library.docs} documents`
      : `${manifest.files.length} files`;
    console.log(`${set.name}: ${what} in ${ms} ms`);
  }
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
