/**
 * Stages dist/desktop-app the way arch §3.1 step 3 describes: a package.json
 * with only name, version and main, the CJS bundles, and renderer/ = out/.
 * Usage (repo root): bun spikes/s4-electron-e2e/stage.ts
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const STAGE = join(import.meta.dir, "stage");
rmSync(STAGE, { recursive: true, force: true });
mkdirSync(STAGE, { recursive: true });
writeFileSync(
  join(STAGE, "package.json"),
  `${JSON.stringify({ name: "tinydocy", version: "0.0.1", main: "main.cjs" }, null, 2)}\n`,
);
for (const file of ["main.cjs", "preload.cjs"]) {
  cpSync(join(ROOT, "spikes/s1-shell/dist", file), join(STAGE, file));
}
cpSync(join(ROOT, "out"), join(STAGE, "renderer"), { recursive: true });
console.log(`[s4] staged ${STAGE}`);
