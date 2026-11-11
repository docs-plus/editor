/**
 * Evicts every project module (not node_modules) from the module cache. Call
 * it in `afterEach` of tests that use {@link importFresh}, so a module loaded
 * under a test's env is not reused by later tests or files.
 */
export function resetModules(): void {
  for (const path of Object.keys(require.cache)) {
    if (!path.includes("/node_modules/")) delete require.cache[path];
  }
}

/**
 * Imports a new instance of a module that reads env vars or keeps state at
 * import time, along with fresh copies of the project modules it imports
 * (such as `guardrail-config`).
 */
export async function importFresh<T>(specifier: string): Promise<T> {
  resetModules();
  return import(Bun.resolveSync(specifier, import.meta.dir));
}
