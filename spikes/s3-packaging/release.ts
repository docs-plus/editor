// Builds one or more versions with electron-builder, each into
// release/<version>/, teeing the builder output to logs/builder-<version>.log.
//   bun release.ts --versions 0.0.1,0.0.2 -- --linux deb AppImage --x64
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

const root = import.meta.dir;
const { values, positionals } = parseArgs({
  options: { versions: { type: "string" } },
  allowPositionals: true,
});
const versions = (values.versions ?? "").split(",").filter(Boolean);
if (versions.length === 0 || positionals.length === 0) {
  throw new Error("usage: bun release.ts --versions a,b -- <builder args>");
}

const run = async (cmd: string[], logFile?: string) => {
  const started = performance.now();
  const proc = Bun.spawn(cmd, {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: "false" },
  });
  let captured = "";
  const pump = async (
    stream: ReadableStream<Uint8Array>,
    out: NodeJS.WriteStream,
  ) => {
    const decoder = new TextDecoder();
    for await (const chunk of stream) {
      const text = decoder.decode(chunk);
      captured += text;
      out.write(text);
    }
  };
  await Promise.all([
    pump(proc.stdout, process.stdout),
    pump(proc.stderr, process.stderr),
  ]);
  const code = await proc.exited;
  if (logFile) writeFileSync(logFile, captured);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}`);
  return seconds;
};

mkdirSync(path.join(root, "logs"), { recursive: true });
await run(["bun", "build.ts"]);
for (const version of versions) {
  const out = path.join("release", version);
  const seconds = await run(
    [
      "bun",
      "electron-builder",
      ...positionals,
      "--publish",
      "never",
      `-c.extraMetadata.version=${version}`,
      `-c.directories.output=${out}`,
    ],
    path.join(root, "logs", `builder-${version}.log`),
  );
  console.log(`\n== ${version} built in ${seconds}s, outputs:`);
  for (const name of readdirSync(path.join(root, out)).sort()) {
    const full = path.join(root, out, name);
    const st = statSync(full);
    if (st.isFile()) console.log(`  ${String(st.size).padStart(11)}  ${name}`);
  }
}
