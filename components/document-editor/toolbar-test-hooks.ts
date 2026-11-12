import { useEffect, useState } from "react";

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

/**
 * Dev-only Playwright switch: true when a test set `window.__TOOLBAR_OFF`
 * before boot, so the perf spec can time typing with the toolbar unmounted.
 * Ready-flag pattern (no hydration mismatch); always false in production.
 */
export function useToolbarOffForTests(): boolean {
  const [off, setOff] = useState(false);
  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    setOff(window.__TOOLBAR_OFF === true);
  }, []);
  return off;
}
