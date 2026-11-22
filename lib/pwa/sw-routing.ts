/** Pure routing rules for the service worker (unit-tested in Node). */

export type SwRoute = "navigation" | "static" | "bypass";

/** Not Request: `new Request(url, { mode: "navigate" })` throws outside a browser. */
type RequestLike = Pick<Request, "method" | "mode" | "url" | "headers">;

const STATIC_PATH = /^\/_next\/static\/(?!service-worker\/)/;
const STATIC_URL_IN_HTML =
  /\/_next\/static\/(?!service-worker\/)[^"'\s)\\<>]+/g;

/**
 * Allowlist: only same-origin GET navigations and /_next/static files are
 * handled. /api/*, RSC (`?_rsc=`), HEAD, Range, metadata routes and every
 * cross-origin request (GA, X, embeds, user images) go straight to the
 * network. WebSockets never reach a service worker.
 */
export function classifyRequest(request: RequestLike, origin: string): SwRoute {
  if (request.method !== "GET" || request.headers.has("range")) return "bypass";
  const url = new URL(request.url);
  if (url.origin !== origin) return "bypass";
  if (request.mode === "navigate") return "navigation";
  if (STATIC_PATH.test(url.pathname)) return "static";
  return "bypass";
}

/** The message a page posts with the static files it loaded uncontrolled. */
export const CACHE_LOADED_MESSAGE = "tinydocy:cache-loaded";

/** At most this many URLs per message, so one message cannot fill the cache. */
const MAX_LOADED_URLS = 200;

/**
 * The same-origin /_next/static paths among `urls` (a page's resource
 * timing names), deduplicated and capped. Anything else a message carries
 * (other origins, /api, the worker itself, non-strings) is dropped.
 */
export function loadedStaticPaths(urls: unknown, origin: string): string[] {
  if (!Array.isArray(urls)) return [];
  const paths = new Set<string>();
  for (const value of urls) {
    if (typeof value !== "string") continue;
    let url: URL;
    try {
      url = new URL(value, origin);
    } catch {
      continue;
    }
    if (url.origin === origin && STATIC_PATH.test(url.pathname)) {
      paths.add(url.pathname);
      if (paths.size === MAX_LOADED_URLS) break;
    }
  }
  return [...paths];
}

/** Every /_next/static URL an HTML page references, deduplicated. */
export function extractStaticAssets(html: string): string[] {
  return [...new Set(html.match(STATIC_URL_IN_HTML) ?? [])];
}

const CSS_URL = /url\(\s*(["']?)([^"')]+)\1\s*\)/g;

/**
 * Every same-origin /_next/static path a stylesheet at `cssUrl` references
 * (its icons and fonts, relative to the sheet), deduplicated. `data:` and
 * cross-origin URLs are skipped.
 */
export function extractCssAssets(css: string, cssUrl: string): string[] {
  const { origin } = new URL(cssUrl);
  const paths = new Set<string>();
  for (const [, , target] of css.matchAll(CSS_URL)) {
    if (/^data:/i.test(target)) continue;
    const url = new URL(target, cssUrl);
    if (url.origin === origin && STATIC_PATH.test(url.pathname)) {
      paths.add(url.pathname);
    }
  }
  return [...paths];
}

/** Never store errors, opaque or redirected bodies, or uncacheable responses. */
export function isCacheableResponse(response: Response): boolean {
  if (response.type !== "basic" && response.type !== "default") return false;
  if (response.status !== 200 || response.redirected) return false;
  if (
    /\b(no-store|private)\b/i.test(response.headers.get("cache-control") ?? "")
  )
    return false;
  return (response.headers.get("vary") ?? "").trim() !== "*";
}
