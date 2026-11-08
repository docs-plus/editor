import type { NextConfig } from "next";

/**
 * Player iframes rendered by @docs.plus/extension-hypermultimedia. Exact
 * hosts only: a pasted URL that maps elsewhere never reaches a frame.
 */
const MEDIA_FRAME_HOSTS = [
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
const X_OEMBED_HOST = "https://publish.x.com";
const X_WIDGET_SCRIPT_HOSTS = [
  "https://platform.twitter.com",
  "https://cdn.syndication.twimg.com",
];

function buildContentSecurityPolicy(): string {
  const hocusUrl =
    process.env.NEXT_PUBLIC_HOCUS_URL?.trim() || "ws://127.0.0.1:1234";

  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    ...(process.env.NODE_ENV === "development" ? ["'unsafe-eval'"] : []),
    ...X_WIDGET_SCRIPT_HOSTS,
  ];

  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "media-src 'self' blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${hocusUrl} ${X_OEMBED_HOST}`,
    `frame-src ${MEDIA_FRAME_HOSTS.join(" ")}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Content-Security-Policy",
            value: buildContentSecurityPolicy(),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
