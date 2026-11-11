/**
 * GA4 settings shared by next.config.ts (CSP) and the client tag. No DOM or
 * React: the Next.js config loader imports this file.
 */
const MEASUREMENT_ID_PATTERN = /^G-[A-Z0-9]{4,20}$/;

/** gtag.js origin. img-src already allows `https:`. */
export const GA_SCRIPT_HOSTS = ["https://www.googletagmanager.com"];

/** GA4 picks regionN collection hosts at runtime, so two are wildcards. */
export const GA_CONNECT_HOSTS = [
  "https://www.googletagmanager.com",
  "https://*.google-analytics.com",
  "https://*.analytics.google.com",
];

export function parseMeasurementId(raw: string | undefined): string | null {
  const id = raw?.trim() ?? "";
  return MEASUREMENT_ID_PATTERN.test(id) ? id : null;
}

/** Null in `next dev`, tests, or without a valid ID: every caller no-ops. */
export function resolveMeasurementId(
  raw: string | undefined,
  nodeEnv: string | undefined,
): string | null {
  return nodeEnv === "production" ? parseMeasurementId(raw) : null;
}

/** Inlined at `bun run build`; setting it only at runtime has no effect. */
export const GA_MEASUREMENT_ID = resolveMeasurementId(
  process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID,
  process.env.NODE_ENV,
);
