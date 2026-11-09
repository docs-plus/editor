// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  classifyRequest,
  extractStaticAssets,
  isCacheableResponse,
} from "@/lib/pwa/sw-routing";

const origin = "https://tiny.docs.plus";

const req = (
  url: string,
  o: { method?: string; mode?: RequestMode; headers?: Headers } = {},
) => ({
  url,
  method: o.method ?? "GET",
  mode: o.mode ?? "cors",
  headers: o.headers ?? new Headers(),
});

describe("classifyRequest", () => {
  it.each([
    [
      "same-origin navigation",
      req(`${origin}/`, { mode: "navigate" }),
      "navigation",
    ],
    [
      "DELETE /api",
      req(`${origin}/api/documents/x`, { method: "DELETE" }),
      "bypass",
    ],
    ["GET /api", req(`${origin}/api/documents/x`), "bypass"],
    [
      "RSC fetch",
      req(`${origin}/about?_rsc=1`, { headers: new Headers({ RSC: "1" }) }),
      "bypass",
    ],
    [
      "HEAD navigation",
      req(`${origin}/`, { method: "HEAD", mode: "navigate" }),
      "bypass",
    ],
    ["static chunk", req(`${origin}/_next/static/chunks/a.js`), "static"],
    [
      "the worker itself",
      req(`${origin}/_next/static/service-worker/sw.js`),
      "bypass",
    ],
    [
      "Range request",
      req(`${origin}/_next/static/media/v.mp4`, {
        headers: new Headers({ Range: "bytes=0-" }),
      }),
      "bypass",
    ],
    [
      "cross-origin script",
      req("https://platform.twitter.com/widgets.js"),
      "bypass",
    ],
    [
      "cross-origin navigation",
      req("https://example.com/", { mode: "navigate" }),
      "bypass",
    ],
    ["metadata route", req(`${origin}/manifest.webmanifest`), "bypass"],
  ] as const)("%s", (_name, request, expected) => {
    expect(classifyRequest(request, origin)).toBe(expected);
  });
});

describe("extractStaticAssets", () => {
  it("finds every /_next/static URL once, never the worker", () => {
    const html = [
      '<script src="/_next/static/chunks/a.js"></script>',
      '<script src="/_next/static/chunks/a.js" async></script>',
      '<link rel="stylesheet" href="/_next/static/css/b.css">',
      '<link rel="preload" href="/_next/static/media/c.p.woff2" as="font">',
      '<script>self.__next_f.push([1,"\\"/_next/static/chunks/d.js\\""])</script>',
      '<script src="/_next/static/service-worker/sw.js"></script>',
    ].join("\n");

    expect(extractStaticAssets(html)).toEqual([
      "/_next/static/chunks/a.js",
      "/_next/static/css/b.css",
      "/_next/static/media/c.p.woff2",
      "/_next/static/chunks/d.js",
    ]);
  });
});

describe("isCacheableResponse", () => {
  it("accepts a plain 200", () => {
    expect(isCacheableResponse(new Response("x"))).toBe(true);
  });

  it.each([404, 429, 500])("rejects status %i", (status) => {
    expect(isCacheableResponse(new Response("x", { status }))).toBe(false);
  });

  it("rejects network errors", () => {
    expect(isCacheableResponse(Response.error())).toBe(false);
  });

  it.each<Record<string, string>>([
    { "cache-control": "no-store" },
    { "cache-control": "private, max-age=0" },
    { vary: "*" },
  ])("rejects %o", (headers) => {
    expect(isCacheableResponse(new Response("x", { headers }))).toBe(false);
  });
});
