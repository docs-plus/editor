import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { NextConfig } from "next";

import { GA_MEASUREMENT_ID } from "./lib/analytics-config";
import { buildContentSecurityPolicy } from "./lib/security/content-security-policy";

function resolveBuildId(): string {
  const fromEnv = process.env.NEXT_PUBLIC_BUILD_ID?.trim();
  if (fromEnv) return fromEnv;
  try {
    const sha = execSync("git rev-parse --short=12 HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    if (sha) return sha;
  } catch {
    // not a git checkout (e.g. a source tarball)
  }
  const pkg = JSON.parse(readFileSync("./package.json", "utf8")) as {
    version: string;
  };
  return pkg.version;
}

const nextConfig: NextConfig = {
  env: { NEXT_PUBLIC_BUILD_ID: resolveBuildId() },
  // Next 16.4+ rewrites AGENTS.md when it detects a coding agent; that file
  // holds curated repo conventions, so keep it hand-maintained.
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Caps what embedded players can request, whatever `allow` a
          // collaborator puts on the iframe.
          {
            key: "Permissions-Policy",
            value:
              "camera=(), microphone=(), geolocation=(), display-capture=(), clipboard-read=(), payment=(), usb=(), serial=(), hid=()",
          },
          {
            key: "Content-Security-Policy",
            value: buildContentSecurityPolicy({
              nodeEnv: process.env.NODE_ENV,
              hocusUrl:
                process.env.NEXT_PUBLIC_HOCUS_URL?.trim() ||
                "ws://127.0.0.1:1234",
              gaMeasurementId: GA_MEASUREMENT_ID,
            }),
          },
        ],
      },
    ];
  },
};

export default nextConfig;
