/**
 * scripts/deploy.sh runs as an SSH forced command, so the client's command
 * line is untrusted input: it must be rejected before anything runs unless
 * it is a full commit SHA. The script must also be executable, or the
 * forced command fails.
 */
import { describe, expect, it } from "bun:test";
import { statSync } from "node:fs";
import path from "node:path";

const SCRIPT = path.resolve(process.cwd(), "scripts/deploy.sh");

const run = (command: string) =>
  Bun.spawnSync(["bash", SCRIPT], {
    env: { PATH: process.env.PATH ?? "", SSH_ORIGINAL_COMMAND: command },
  });

describe("scripts/deploy.sh", () => {
  it("is executable", () => {
    expect(statSync(SCRIPT).mode & 0o111).not.toBe(0);
  });

  it.each([
    "",
    "main",
    "d9ea78d",
    "; rm -rf /",
    "$(touch /tmp/pwned)",
    "D9EA78D0000000000000000000000000000000000",
    "d9ea78d00000000000000000000000000000000000 extra",
  ])("refuses %p before doing anything", (command) => {
    const result = run(command);
    expect(result.exitCode).toBe(2);
    expect(result.stdout.toString()).toBe("");
    expect(result.stderr.toString()).toContain("40-character commit SHA");
  });
});
