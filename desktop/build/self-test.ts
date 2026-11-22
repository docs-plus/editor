/**
 * Starts an installed TinyDocy once with `TINYDOCY_QUIT_AFTER_READY=1`: the
 * app opens its library and first window, then quits through the normal
 * quit path. Passes when it exits 0 within the time limit, after reporting
 * a ready library and the quit coordinator's `exit` mark.
 *
 *   bun desktop/build/self-test.ts <executable> [extra env as KEY=VALUE…]
 *
 * On Linux run it under `xvfb-run -a`.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const [executable, ...extra] = process.argv.slice(2);
if (!executable) {
  console.error("usage: bun desktop/build/self-test.ts <executable>");
  process.exit(2);
}

const LIMIT_MS = 120_000;
const env: Record<string, string> = {
  ...(process.env as Record<string, string>),
  TINYDOCY_USER_DATA: mkdtempSync(join(tmpdir(), "tinydocy-self-test-")),
  TINYDOCY_QUIT_AFTER_READY: "1",
  TINYDOCY_DIAGNOSTICS_STDOUT: "1",
};
for (const pair of extra) {
  const at = pair.indexOf("=");
  if (at > 0) env[pair.slice(0, at)] = pair.slice(at + 1);
}

const started = performance.now();
const child = Bun.spawn([executable], { env, stdout: "pipe", stderr: "pipe" });
const timer = setTimeout(() => child.kill(), LIMIT_MS);
const [stdout, stderr, code] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
]);
clearTimeout(timer);
const ms = Math.round(performance.now() - started);

const events = stdout
  .split("\n")
  .filter((line) => line.startsWith("[tinydocy] "))
  .map(
    (line) =>
      JSON.parse(line.slice("[tinydocy] ".length)) as Record<string, unknown>,
  );
for (const event of events) console.log(JSON.stringify(event));

const ready = events.find((e) => e.event === "self_test_ready");
const exited = events.some((e) => e.event === "exit");
const problems: string[] = [];
if (child.signalCode) problems.push(`killed after ${LIMIT_MS} ms`);
if (code !== 0) problems.push(`exit code ${code}`);
if (ready?.storage !== "ready")
  problems.push(`library not ready (${String(ready?.storage)})`);
if (!exited) problems.push("no quit `exit` mark");

if (problems.length > 0) {
  console.error(stderr.split("\n").slice(-40).join("\n"));
  console.error(`[self-test] FAIL after ${ms} ms: ${problems.join("; ")}`);
  process.exit(1);
}
console.log(`[self-test] ok: started, opened the library and quit in ${ms} ms`);
