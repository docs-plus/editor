import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

import { GA_MEASUREMENT_ID } from "./lib/analytics-config";
import { buildContentSecurityPolicy } from "./lib/security/content-security-policy";
import { listParked, PARKING_DIR } from "./scripts/desktop-export";

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

// The one build-time switch between the two renderers (desktop
// architecture §3.1 step 1). `bun run build:desktop` sets it.
const isDesktop = process.env.NEXT_PUBLIC_APP_TARGET === "desktop";

// A desktop export that was killed can leave web-only files parked; a web
// build now would ship without its sitemap, manifest or privacy page.
const parked = isDesktop ? [] : listParked(process.cwd());
if (parked.length > 0) {
  throw new Error(
    `${parked.join(", ")} are parked in ${PARKING_DIR}/ by an interrupted desktop export. Run \`bun run build:desktop\` once (it puts them back first), or move them back into app/.`,
  );
}

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: resolveBuildId(),
    // Always defined, so the bundler inlines it and drops the other target's
    // branches; an unset NEXT_PUBLIC_* stays a runtime lookup.
    NEXT_PUBLIC_APP_TARGET: process.env.NEXT_PUBLIC_APP_TARGET ?? "web",
    // Same for Find (P2.11): a web build without it drops the key listener.
    NEXT_PUBLIC_FIND: process.env.NEXT_PUBLIC_FIND ?? "",
  },
  // Web-only route handlers are `route.web.ts(x)`, which the desktop
  // extensions don't match; `*.desktop.tsx` is the desktop-only
  // counterpart. Web-only pages and metadata files are parked instead
  // (scripts/desktop-export.ts).
  pageExtensions: isDesktop
    ? ["desktop.tsx", "tsx", "ts"]
    : ["web.tsx", "web.ts", "tsx", "ts"],
  // The export type-checks a tree with web-only files parked, which the
  // route types `next dev` generated (.next/dev/types) still import.
  // `bun run typecheck` checks every file, desktop ones included.
  ...(isDesktop ? { typescript: { ignoreBuildErrors: true } } : {}),
  // Next 16.4+ rewrites AGENTS.md when it detects a coding agent; that file
  // holds curated repo conventions, so keep it hand-maintained.
  agentRules: false,
  poweredByHeader: false,
  // A static export has no server to send headers; the desktop shell sets
  // its own CSP (P2.5).
  ...(isDesktop ? {} : { headers: webHeaders }),
};

async function webHeaders() {
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
}

// Desktop is a static export loaded from app://tinydocy. Only the build
// exports: under `next dev` (the `local` Playwright project) the web
// metadata files aren't parked, and `output: "export"` would make each of
// them a 500 that every page links.
export default function config(phase: string): NextConfig {
  return isDesktop && phase === PHASE_PRODUCTION_BUILD
    ? { ...nextConfig, output: "export" }
    : nextConfig;
}
