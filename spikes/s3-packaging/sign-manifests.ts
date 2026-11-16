// Throwaway Ed25519 manifest signing for the S3 spike (never commit a key).
//   bun sign-manifests.ts keygen --dir $RUNNER_TEMP/keys
//       writes manifest-key.pem (private, 0600) and manifest-key.pub.pem
//   bun sign-manifests.ts sign --key <private.pem> --out <feed dir> <yml>...
//       copies each <yml> into <feed dir> and writes <name>.yml.sig (base64)
//   bun sign-manifests.ts tamper <feed dir>/<name>.yml
//       rewrites the version line after signing, leaving the .sig alone
import { createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const [command, ...rest] = process.argv.slice(2);
const { values, positionals } = parseArgs({
  args: rest,
  options: {
    dir: { type: "string" },
    key: { type: "string" },
    out: { type: "string" },
  },
  allowPositionals: true,
});

switch (command) {
  case "keygen": {
    const dir = values.dir ?? "keys";
    mkdirSync(dir, { recursive: true });
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(
      path.join(dir, "manifest-key.pem"),
      privateKey.export({ type: "pkcs8", format: "pem" }),
      { mode: 0o600 },
    );
    writeFileSync(
      path.join(dir, "manifest-key.pub.pem"),
      publicKey.export({ type: "spki", format: "pem" }),
    );
    console.log(`keys written to ${dir}`);
    break;
  }
  case "sign": {
    if (!values.key || !values.out) throw new Error("--key and --out required");
    const key = createPrivateKey(readFileSync(values.key));
    mkdirSync(values.out, { recursive: true });
    for (const file of positionals) {
      const target = path.join(values.out, path.basename(file));
      if (path.resolve(file) !== path.resolve(target))
        copyFileSync(file, target);
      const sig = sign(null, readFileSync(target), key).toString("base64");
      writeFileSync(`${target}.sig`, `${sig}\n`);
      console.log(`signed ${target}`);
    }
    break;
  }
  case "tamper": {
    for (const file of positionals) {
      const text = readFileSync(file, "utf8");
      const tampered = text.replace(/^version: .*$/m, "version: 9.9.9");
      if (tampered === text) throw new Error(`no version line in ${file}`);
      writeFileSync(file, tampered);
      console.log(`tampered ${file} (version -> 9.9.9, signature unchanged)`);
    }
    break;
  }
  default:
    throw new Error("usage: keygen | sign | tamper");
}
