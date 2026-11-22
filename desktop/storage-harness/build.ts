/**
 * Bundles the harness main and the real storage worker as CJS for
 * Electron, the way `desktop/build/build.ts` (P2.5) will: `node:*` and
 * `electron` stay external, everything else (Yjs, the engine) is inlined.
 */
import path from "node:path";

const root = import.meta.dir;
const result = await Bun.build({
  entrypoints: [
    path.join(root, "main.ts"),
    path.join(root, "../storage/worker.ts"),
    path.join(root, "../storage/copy-worker.ts"),
  ],
  outdir: path.join(root, "dist"),
  target: "node",
  format: "cjs",
  external: ["electron"],
  naming: "[name].cjs",
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const output of result.outputs)
  console.log(`${path.relative(root, output.path)} ${output.size} B`);
