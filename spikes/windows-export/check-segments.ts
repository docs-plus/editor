/**
 * Spike (#103): where did `next build` with `output: "export"` write the
 * segment-prefetch payloads, and does a plain static server answer the URL
 * the client router asks for?
 *
 * The client requests `<route>/__next.<segment path with "/" → ".">.txt`
 * (`convertSegmentPathToStaticExportFilename`). On Windows the export joins a
 * backslashed relative path into that name, so the file lands in a
 * `__next.<segment>/` directory instead.
 *
 * Usage: bun spikes/windows-export/check-segments.ts <appDir> [label]
 * (`<appDir>/out` is the export; `<appDir>/node_modules/next` gives the version)
 * Prints one JSON line and writes it to $CHECK_SEGMENTS_JSON when set.
 * Exits 1 only when neither layout is found (the probe itself is broken).
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

const appDir = resolve(process.argv[2] ?? ".");
const outDir = join(appDir, "out");
const label = process.argv[3] ?? "";

/** The URLs the client router requests for this app's two routes. */
const CLIENT_URLS = [
  "/about/__next.about.__PAGE__.txt",
  "/_not-found/__next._not-found.__PAGE__.txt",
];

/**
 * Every directory under `outDir` whose name starts with `__next.`. A correct
 * export has none: segment payloads are flat files. A stage step can fail on
 * a non-empty result so a Windows-built renderer never ships.
 */
export function findNestedSegmentDirs(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const full = join(current, entry.name);
      if (entry.name.startsWith("__next.")) {
        found.push(relative(dir, full).split(sep).join("/"));
      }
      walk(full);
    }
  };
  walk(dir);
  return found.sort();
}

function listSegmentFiles(dir: string): string[] {
  return (readdirSync(dir, { recursive: true }) as string[])
    .map((p) => p.split(sep).join("/"))
    .filter((p) => p.includes("__next.") && p.endsWith(".txt"))
    .sort();
}

if (import.meta.main) {
  // A static server with no rewrites: the same lookup any host (or a naive
  // `app://` handler) does, path → file.
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const path = decodeURIComponent(new URL(req.url).pathname);
      const file = Bun.file(join(outDir, path));
      return file
        .exists()
        .then((ok) =>
          ok ? new Response(file) : new Response("not found", { status: 404 }),
        );
    },
  });
  const statuses: Record<string, number> = {};
  for (const url of CLIENT_URLS) {
    const res = await fetch(new URL(url, server.url));
    statuses[url] = res.status;
  }
  server.stop(true);

  const nested = findNestedSegmentDirs(outDir);
  const result = {
    label,
    platform: process.platform,
    next: (
      JSON.parse(
        readFileSync(join(appDir, "node_modules/next/package.json"), "utf8"),
      ) as { version: string }
    ).version,
    layout: nested.length ? "nested (bug)" : "flat (ok)",
    nestedDirs: nested,
    segmentFiles: listSegmentFiles(outDir),
    clientUrlStatus: statuses,
  };
  const line = JSON.stringify(result);
  console.log(line);
  if (process.env.CHECK_SEGMENTS_JSON) {
    writeFileSync(process.env.CHECK_SEGMENTS_JSON, `${line}\n`);
  }
  const anyFlat = Object.values(statuses).some((s) => s === 200);
  if (!nested.length && !anyFlat) process.exit(1);
}
