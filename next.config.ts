import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";

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

// The one build-time switch between the two renderers (desktop
// architecture §3.1 step 1). `bun run build:desktop` sets it.
const isDesktop = process.env.NEXT_PUBLIC_APP_TARGET === "desktop";

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: resolveBuildId(),
    // Always defined, so the bundler inlines it and drops the other target's
    // branches; an unset NEXT_PUBLIC_* stays a runtime lookup.
    NEXT_PUBLIC_APP_TARGET: process.env.NEXT_PUBLIC_APP_TARGET ?? "web",
    // Same for Find (P2.11): a web build without it drops the key listener.
    NEXT_PUBLIC_FIND: process.env.NEXT_PUBLIC_FIND ?? "",
    // "dev" only for a desktop-target `next dev` over the dev storage host
    // (the `local` project); defined so release builds drop that branch.
    NEXT_PUBLIC_DESKTOP_BRIDGE: process.env.NEXT_PUBLIC_DESKTOP_BRIDGE ?? "",
  },
  // Desktop routes are an allowlist: only `*.desktop.tsx` files (the root
  // page, and re-exports of the layout, error page and /about). Every plain
  // web page, route handler and metadata file (sitemap, manifest, Open
  // Graph image) is invisible to it, so nothing is moved for the export;
  // the web never matches `.desktop.tsx`. A plain `page.tsx` beside a
  // `page.desktop.tsx` would win, so the two lists can't overlap. The list
  // also leaves out Next's other convention files on desktop (`not-found`,
  // `global-error`, `instrumentation`, `proxy`): add a `.desktop.tsx` one
  // if desktop needs it.
  pageExtensions: isDesktop
    ? ["desktop.tsx", "desktop.ts"]
    : ["web.tsx", "web.ts", "tsx", "ts"],
  // Next 16.4+ rewrites AGENTS.md when it detects a coding agent; that file
  // holds curated repo conventions, so keep it hand-maintained.
  agentRules: false,
  poweredByHeader: false,
  // cmdk's unused `Command.Dialog` would carry Radix Dialog into the
  // palette chunk (contract A7: palette plus cmdk within 20 KB gz).
  turbopack: {
    resolveAlias: {
      "@radix-ui/react-dialog": "./lib/cmdk-radix-dialog-stub.ts",
    },
  },
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
// exports: `next dev` (the `local` Playwright project) serves as usual.
export default function config(phase: string): NextConfig {
  if (!isDesktop || phase !== PHASE_PRODUCTION_BUILD) return nextConfig;
  // The dev bridge is for `next dev` only; NODE_ENV alone can't keep it out
  // of a build (Bun), and the export check would only catch it afterwards.
  if (process.env.NEXT_PUBLIC_DESKTOP_BRIDGE === "dev") {
    throw new Error(
      "NEXT_PUBLIC_DESKTOP_BRIDGE=dev is for a desktop-target next dev only; unset it to build the desktop renderer.",
    );
  }
  return { ...nextConfig, output: "export" };
}
