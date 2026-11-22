/**
 * Bundles the harness main and the real storage worker as CJS for
 * Electron, the way `desktop/build/build.ts` (P2.5) will: `node:*` and
 * `electron` stay external, everything else (Yjs, the engine) is inlined.
 * `bun:test` resolves to a small shim, so the `LibraryIndex` contract
 * (written for `bun test`) runs in Electron main too.
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
  plugins: [
    {
      name: "bun-test-shim",
      setup(build) {
        build.onResolve({ filter: /^bun:test$/ }, () => ({
          path: path.join(root, "../../tests/helpers/bun-test-shim.ts"),
        }));
      },
    },
  ],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
for (const output of result.outputs)
  console.log(`${path.relative(root, output.path)} ${output.size} B`);
