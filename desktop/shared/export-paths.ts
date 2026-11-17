/**
 * Maps a request path on the desktop origin to a file in the static export
 * (`out/`), the way the `app://tinydocy` protocol handler serves it
 * (desktop architecture §3.1; hardening checklist P2.4). Pure: the caller
 * says which files exist, so the Electron handler (P2.5) and the test
 * server (`scripts/serve-desktop-export.ts`) share one rule set.
 *
 * - `/` → `index.html`, `/about` → `about.html` (a page has a `.html` file
 *   and a same-named directory of segment payloads).
 * - RSC payloads are served as they were exported: `about.txt`,
 *   `about/__next.about.__PAGE__.txt`. Never renamed (#103: no Windows
 *   layout mapping).
 * - Extension-less files get a type from `EXTENSIONLESS_TYPES`; others are
 *   refused, so nothing is served without a known type (`nosniff`).
 * - Paths that decode to `..`, a backslash, a NUL or an empty segment are
 *   refused before any lookup.
 */

export type ExportFile = {
  /** Path relative to `out/`, with `/` separators. */
  file: string;
  contentType: string;
};

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  ico: "image/x-icon",
  woff2: "font/woff2",
  woff: "font/woff",
  wasm: "application/wasm",
};

/** Metadata images Next writes without an extension. */
export const EXTENSIONLESS_TYPES: Record<string, string> = {
  icon: "image/png",
};

function extensionOf(file: string): string | null {
  const name = file.slice(file.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : null;
}

function typeOf(file: string): string | null {
  const ext = extensionOf(file);
  if (ext !== null) return TYPES[ext] ?? null;
  return EXTENSIONLESS_TYPES[file] ?? null;
}

/**
 * The file to serve for `pathname` (the URL's path, still percent-encoded),
 * or null for a 404. `isFile(rel)` reports whether `out/<rel>` is a file.
 */
export function resolveExportFile(
  pathname: string,
  isFile: (rel: string) => boolean,
): ExportFile | null {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (!path.startsWith("/") || /[\\\0]/.test(path)) return null;

  const rel = path.slice(1).replace(/\/$/, "");
  const segments = rel === "" ? [] : rel.split("/");
  if (segments.some((s) => s === "" || s === "." || s === "..")) return null;

  const candidates =
    rel === ""
      ? ["index.html"]
      : extensionOf(rel) === null
        ? [`${rel}.html`, rel, `${rel}/index.html`]
        : [rel];
  for (const file of candidates) {
    const contentType = typeOf(file);
    if (contentType && isFile(file)) return { file, contentType };
  }
  return null;
}
