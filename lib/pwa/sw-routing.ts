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

/** Every /_next/static URL an HTML page references, deduplicated. */
export function extractStaticAssets(html: string): string[] {
  return [...new Set(html.match(STATIC_URL_IN_HTML) ?? [])];
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
