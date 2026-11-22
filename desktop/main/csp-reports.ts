/**
 * CSP reports from the preload (`diag.csp`, SEC-010). A page may send them,
 * so main keeps at most `CSP_REPORTS_PER_WINDOW` per window per minute,
 * logs one `csp_reports_dropped` for the rest, and keeps only a directive
 * or scheme token from each report, never a URL.
 */
export const CSP_REPORTS_PER_WINDOW = 50;
export const CSP_REPORT_WINDOW_MS = 60_000;

/** A directive name or URL scheme from the page, or "?" for anything else. */
export function reportToken(value: unknown): string {
  return typeof value === "string" && /^[a-z][a-z0-9.+-]{0,39}:?$/i.test(value)
    ? value
    : "?";
}
