import { GA_CONNECT_HOSTS, GA_SCRIPT_HOSTS } from "../analytics-config";

/**
 * Player iframes rendered by @docs.plus/extension-hypermultimedia. Exact
 * hosts only: a pasted URL that maps elsewhere never reaches a frame.
 */
export const MEDIA_FRAME_HOSTS = [
  "https://www.youtube.com",
  "https://www.youtube-nocookie.com",
  "https://player.vimeo.com",
  "https://www.loom.com",
  "https://w.soundcloud.com",
  "https://open.spotify.com",
  "https://platform.twitter.com",
  "https://syndication.twitter.com",
];

/** X post embeds: oEmbed lookup plus X's widgets script. */
export const X_OEMBED_HOST = "https://publish.x.com";
export const X_WIDGET_SCRIPT_HOSTS = [
  "https://platform.twitter.com",
  "https://cdn.syndication.twimg.com",
];

interface ContentSecurityPolicyOptions {
  nodeEnv: string | undefined;
  /** Collaboration WebSocket origin (NEXT_PUBLIC_HOCUS_URL). */
  hocusUrl: string;
  /** Adds the GA4 hosts only when analytics is configured. */
  gaMeasurementId: string | null;
}

/**
 * Builds the CSP header. Imported by next.config.ts, so it uses relative
 * imports only (the config loader does not resolve the `@/` alias).
 */
export function buildContentSecurityPolicy({
  nodeEnv,
  hocusUrl,
  gaMeasurementId,
}: ContentSecurityPolicyOptions): string {
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(nodeEnv === "development" ? ["'unsafe-eval'"] : []),
    ...X_WIDGET_SCRIPT_HOSTS,
    ...(gaMeasurementId ? GA_SCRIPT_HOSTS : []),
  ];
  const connectSources = [
    "'self'",
    hocusUrl,
    X_OEMBED_HOST,
    ...(gaMeasurementId ? GA_CONNECT_HOSTS : []),
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    `connect-src ${connectSources.join(" ")}`,
    `frame-src ${MEDIA_FRAME_HOSTS.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}
