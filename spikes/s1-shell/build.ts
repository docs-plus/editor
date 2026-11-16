/**
 * CJS bundles for Electron main and the sandboxed preload (arch §3.1 step 2).
 * Usage: bun spikes/s1-shell/build.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = import.meta.dir;
const result = await Bun.build({
  entrypoints: [join(dir, "main.ts"), join(dir, "preload.ts")],
  target: "node",
  format: "cjs",
  external: ["electron"],
  naming: "[name].cjs",
  outdir: join(dir, "dist"),
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// A sandboxed preload can only require "electron" (and a few polyfills).
const preload = readFileSync(join(dir, "dist/preload.cjs"), "utf8");
const requires = [...preload.matchAll(/require\(["']([^"']+)["']\)/g)].map(
  (m) => m[1],
);
const foreign = requires.filter((name) => name !== "electron");
console.log(
  `[s1] preload requires: ${[...new Set(requires)].join(", ") || "none"}`,
);
const main = readFileSync(join(dir, "dist/main.cjs"), "utf8");
console.log(
  `[s1] main.cjs has bun: imports: ${/require\(["']bun:/.test(main)}`,
);
if (foreign.length) {
  console.error(
    `[s1] preload requires non-electron modules: ${foreign.join(", ")}`,
  );
  process.exit(1);
}
for (const output of result.outputs) {
  console.log(`[s1] ${output.path.replace(`${dir}/`, "")} ${output.size} B`);
}
