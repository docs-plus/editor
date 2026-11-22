/**
 * Pure checks `build.ts` runs before staging (kept apart so unit tests can
 * import them without running a build).
 */
import { lstatSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * Test-hook names that must never reach a release bundle (SEC-006): the
 * release flavor defines `__TINYDOCY_TEST_HOOKS__` false, which folds
 * `desktop/main/test-hooks.ts` to `null`, so none of these strings remain.
 */
export const TEST_HOOK_MARKERS = [
  "TINYDOCY_USER_DATA",
  "TINYDOCY_DIAGNOSTICS_STDOUT",
  "TINYDOCY_EXTERNAL_OPEN",
  "TINYDOCY_QUIT_AFTER_READY",
  "TINYDOCY_HIDDEN",
  "__tinydocyDiagnostics",
] as const;

/** The test-hook markers `code` still contains. */
export function testHookMarkersIn(code: string): string[] {
  return TEST_HOOK_MARKERS.filter((marker) => code.includes(marker));
}

/**
 * Every symbolic link under `dir`, relative to it (SEC-009). The protocol
 * handler would follow a link out of the renderer folder, so a renderer
 * that contains one is refused before it is copied. Links are reported,
 * never followed.
 */
export function symlinksUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const name of readdirSync(current)) {
      const path = join(current, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink())
        found.push(relative(dir, path).split("\\").join("/"));
      else if (stat.isDirectory()) walk(path);
    }
  };
  walk(dir);
  return found.sort();
}
