/**
 * After a web `bun next build`: the web-only metadata routes exist under
 * their real paths, and no route was registered with a `.web` suffix.
 * Usage (repo root): bun spikes/s1-shell/check-web-routes.ts
 */
import { readFileSync } from "node:fs";

const routes = Object.values(
  JSON.parse(
    readFileSync(".next/app-path-routes-manifest.json", "utf8"),
  ) as Record<string, string>,
);
const expected = [
  "/sitemap.xml",
  "/robots.txt",
  "/opengraph-image",
  "/manifest.webmanifest",
  "/apple-icon",
  "/privacy",
  "/llms.txt",
  "/api/documents/[id]",
  "/offline",
];
const missing = expected.filter((r) => !routes.includes(r));
const webSuffixed = routes.filter((r) => /\.web(\/|$)/.test(r));
console.log(`[s1] web routes: ${routes.sort().join(" ")}`);
console.log(
  `[s1] missing: ${missing.join(" ") || "none"}; .web-suffixed: ${webSuffixed.join(" ") || "none"}`,
);
process.exit(missing.length || webSuffixed.length ? 1 : 0);
