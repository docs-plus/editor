/**
 * Serves the desktop static export (`out/`) over loopback HTTP, with the
 * path rules of the `app://tinydocy` protocol handler
 * (`desktop/shared/export-paths.ts`). For the `desktop` Playwright project
 * until the Electron shell (P2.5) can run it; never a production server.
 *
 *   bun run build:desktop && PORT=3849 bun scripts/serve-desktop-export.ts
 */
import { statSync } from "node:fs";
import { join, resolve } from "node:path";

import { resolveExportFile } from "@/desktop/shared/export-paths";

const OUT_DIR = resolve(process.env.DESKTOP_OUT_DIR ?? "out");
const PORT = Number(process.env.PORT ?? 3849);

function isFile(rel: string): boolean {
  try {
    return statSync(join(OUT_DIR, rel)).isFile();
  } catch {
    return false;
  }
}

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: PORT,
  fetch(request) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method not allowed", { status: 405 });
    }
    const found = resolveExportFile(new URL(request.url).pathname, isFile);
    if (!found) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(join(OUT_DIR, found.file)), {
      headers: {
        "content-type": found.contentType,
        "x-content-type-options": "nosniff",
      },
    });
  },
});

console.log(`[serve-desktop-export] ${OUT_DIR} on ${server.url}`);
