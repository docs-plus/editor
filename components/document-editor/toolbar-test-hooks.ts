/**
 * Dev-only Playwright hooks for the toolbar. A `<Profiler>` around the
 * toolbar's children calls {@link countToolbarCommit} on every React commit
 * that touches them, so e2e tests can assert how often typing re-renders the
 * toolbar. Production builds skip the count (and React drops `onRender`).
 */
export function countToolbarCommit(): void {
  if (process.env.NODE_ENV === "production") return;
  window.__toolbarCommits = (window.__toolbarCommits ?? 0) + 1;
}
