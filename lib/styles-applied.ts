/**
 * Longest wait for lazy CSS to apply: a stylesheet stalled on a bad
 * network shows its surface unstyled after this rather than never.
 */
export const STYLES_APPLIED_TIMEOUT_MS = 1500;

/**
 * Every `<link rel=stylesheet>` that has loaded applies to the page. Safari
 * (WebKit) keeps a loaded stylesheet out of `document.styleSheets`, and off
 * the page, while another one is still loading, so a lazy chunk's CSS can
 * apply a moment after its import resolved. A link still loading, or one
 * that failed (offline), has no sheet and does not count.
 */
const applied = () => {
  const active = Array.from(document.styleSheets);
  return Array.from(
    document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
  ).every(({ sheet }) => !sheet || active.includes(sheet));
};

/**
 * Resolves once the CSS loaded so far applies (at once outside Safari), or
 * after `timeout`. Lazy surfaces wait for it before they first render, so
 * Safari never paints one unstyled.
 */
export const stylesApplied = (timeout = STYLES_APPLIED_TIMEOUT_MS) =>
  new Promise<void>((resolve) => {
    const start = performance.now();
    const check = () => {
      if (applied() || performance.now() - start > timeout) resolve();
      else requestAnimationFrame(check);
    };
    check();
  });
