/**
 * The `app://tinydocy` protocol handler (D-A11; architecture §3.1): serves
 * the static export from `<appPath>/renderer` with the path rules in
 * `desktop/shared/export-paths.ts` (traversal, unknown types and the
 * Windows segment layout are refused there). Every HTML response carries
 * the desktop CSP with that page's inline-script hashes.
 */

import { statSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { protocol } from "electron";

import { APP_HOST, APP_SCHEME } from "../shared/app-identity";
import { resolveExportFile } from "../shared/export-paths";
import { buildDesktopCsp, hashInline } from "./csp";
import { diagnostics } from "./diagnostics";

/** Must run before `app` is ready. */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: APP_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true },
    },
  ]);
}

export type AppProtocolOptions = {
  rendererDir: string;
  syncUrl: string;
  runtimeStyleHashes: readonly string[];
};

const COMMON_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
};

function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: { "content-type": "text/plain; charset=utf-8", ...COMMON_HEADERS },
  });
}

export function installAppProtocol(options: AppProtocolOptions): void {
  const cspByFile = new Map<string, string>();
  const isFile = (rel: string) => {
    try {
      return statSync(join(options.rendererDir, rel)).isFile();
    } catch {
      return false;
    }
  };

  protocol.handle(APP_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      if (url.host !== APP_HOST || request.method !== "GET") return notFound();
      const found = resolveExportFile(url.pathname, isFile);
      if (!found) {
        diagnostics.log("protocol_404");
        return notFound();
      }
      const path = join(options.rendererDir, found.file);
      const body = await readFile(path);
      const headers: Record<string, string> = {
        "content-type": found.contentType,
        ...COMMON_HEADERS,
      };
      if (found.contentType.startsWith("text/html")) {
        let csp = cspByFile.get(found.file);
        if (!csp) {
          csp = buildDesktopCsp({
            syncUrl: options.syncUrl,
            hashes: hashInline(body.toString("utf8")),
            runtimeStyleHashes: options.runtimeStyleHashes,
          });
          cspByFile.set(found.file, csp);
        }
        headers["content-security-policy"] = csp;
        diagnostics.log("protocol_html");
      }
      return new Response(body, { headers });
    } catch {
      diagnostics.log("protocol_error");
      return notFound();
    }
  });
}

/** For the D-A12 check: the export's entry page exists. */
export async function rendererHasIndex(rendererDir: string): Promise<boolean> {
  try {
    return (await stat(join(rendererDir, "index.html"))).isFile();
  } catch {
    return false;
  }
}
