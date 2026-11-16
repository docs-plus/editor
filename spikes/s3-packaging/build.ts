// Bundles src/main.ts into dist/main.cjs (CJS: package.json is "type":
// "module"). electron and electron-updater stay external: electron-updater
// is a production dependency that electron-builder's Bun collector copies
// into app.asar. The manifest public key (PEM) is built in when
// TINYDOCY_MANIFEST_PUBKEY_FILE points at one.
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

const root = import.meta.dir;
const keyFile = process.env.TINYDOCY_MANIFEST_PUBKEY_FILE;
const publicKey =
  keyFile && existsSync(keyFile) ? readFileSync(keyFile, "utf8") : "";

rmSync(path.join(root, "dist"), { recursive: true, force: true });
const result = await Bun.build({
  entrypoints: [path.join(root, "src/main.ts")],
  outdir: path.join(root, "dist"),
  target: "node",
  format: "cjs",
  naming: "[name].cjs",
  external: ["electron", "electron-updater", "electron-updater/*"],
  define: {
    __FEED_URL__: JSON.stringify("http://127.0.0.1:8787/feed/"),
    __MANIFEST_PUBLIC_KEY__: JSON.stringify(publicKey),
  },
});
if (!result.success) {
  for (const m of result.logs) console.error(m);
  process.exit(1);
}
console.log(
  `bundled ${result.outputs.map((o) => path.relative(root, o.path)).join(", ")} (public key ${publicKey ? "built in" : "absent"})`,
);
