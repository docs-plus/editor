/**
 * Test hooks (SEC-006): environment switches the `electron` specs and the
 * installer self-test use. They exist only in the **test** flavor:
 * `desktop/build/build.ts --flavor release` defines
 * `__TINYDOCY_TEST_HOOKS__` as `false`, so this object folds to `null` and
 * the variable names never reach the release bundle (a build check greps
 * for them). Unbundled (unit tests, dev), the hooks are on.
 *
 * - `TINYDOCY_USER_DATA`: a userData (and library) folder per test.
 * - `TINYDOCY_DIAGNOSTICS_STDOUT=1`: the diagnostics ring on stdout, and on
 *   `globalThis.__tinydocyDiagnostics` for Playwright.
 * - `TINYDOCY_EXTERNAL_OPEN=log`: log links instead of opening a browser.
 * - `TINYDOCY_QUIT_AFTER_READY=1`: start, open the library, quit.
 * - `TINYDOCY_HIDDEN=1`: never show a window (local runs on a desktop).
 */
declare const __TINYDOCY_TEST_HOOKS__: boolean | undefined;

export type TestHooks = {
  userData: string | undefined;
  diagnosticsStdout: boolean;
  externalOpenLogOnly: boolean;
  quitAfterReady: boolean;
  hidden: boolean;
};

export const testHooks: TestHooks | null =
  typeof __TINYDOCY_TEST_HOOKS__ === "undefined" || __TINYDOCY_TEST_HOOKS__
    ? {
        userData: process.env.TINYDOCY_USER_DATA || undefined,
        diagnosticsStdout: process.env.TINYDOCY_DIAGNOSTICS_STDOUT === "1",
        externalOpenLogOnly: process.env.TINYDOCY_EXTERNAL_OPEN === "log",
        quitAfterReady: process.env.TINYDOCY_QUIT_AFTER_READY === "1",
        hidden: process.env.TINYDOCY_HIDDEN === "1",
      }
    : null;

/** Test builds only: lets Playwright read main's diagnostics ring. */
export function exposeDiagnostics(ring: unknown): void {
  if (typeof __TINYDOCY_TEST_HOOKS__ === "undefined" || __TINYDOCY_TEST_HOOKS__)
    (globalThis as { __tinydocyDiagnostics?: unknown }).__tinydocyDiagnostics =
      ring;
}
