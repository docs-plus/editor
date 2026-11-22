import { describe, expect, it } from "bun:test";

import { resolveExportFile } from "@/desktop/shared/export-paths";

/** The top of a real desktop export (`bun run build:desktop`). */
const OUT = new Set([
  "index.html",
  "index.txt",
  "404.html",
  "about.html",
  "about.txt",
  "about/__next.about.__PAGE__.txt",
  "__next._tree.txt",
  "icon",
  "favicon.ico",
  "_next/static/chunks/abc.js",
  "_next/static/chunks/abc.css",
  "_next/static/media/font.woff2",
  "_next/static/media/service-worker.123.ts",
]);
const resolve = (path: string) => resolveExportFile(path, (f) => OUT.has(f));

describe("resolveExportFile", () => {
  it("maps pages to their .html file", () => {
    expect(resolve("/")).toEqual({
      file: "index.html",
      contentType: "text/html; charset=utf-8",
    });
    expect(resolve("/about")?.file).toBe("about.html");
    expect(resolve("/about/")?.file).toBe("about.html");
  });

  it("serves RSC payloads under their exported names", () => {
    expect(resolve("/about.txt")).toEqual({
      file: "about.txt",
      contentType: "text/plain; charset=utf-8",
    });
    expect(resolve("/about/__next.about.__PAGE__.txt")?.file).toBe(
      "about/__next.about.__PAGE__.txt",
    );
    expect(resolve("/__next._tree.txt")?.file).toBe("__next._tree.txt");
  });

  it("gives the extension-less icon its image type", () => {
    expect(resolve("/icon")).toEqual({
      file: "icon",
      contentType: "image/png",
    });
    expect(resolve("/favicon.ico")?.contentType).toBe("image/x-icon");
  });

  it("types static assets", () => {
    expect(resolve("/_next/static/chunks/abc.js")?.contentType).toBe(
      "text/javascript; charset=utf-8",
    );
    expect(resolve("/_next/static/chunks/abc.css")?.contentType).toBe(
      "text/css; charset=utf-8",
    );
    expect(resolve("/_next/static/media/font.woff2")?.contentType).toBe(
      "font/woff2",
    );
  });

  it("refuses files with no known type", () => {
    expect(resolve("/_next/static/media/service-worker.123.ts")).toBeNull();
  });

  it("returns null for web-only and unknown routes", () => {
    for (const path of ["/privacy", "/api/documents/x", "/sitemap.xml", "/x"]) {
      expect(resolve(path)).toBeNull();
    }
  });

  it("refuses traversal and malformed paths before any lookup", () => {
    const looked: string[] = [];
    const spy = (f: string) => {
      looked.push(f);
      return true;
    };
    for (const path of [
      "/../etc/passwd",
      "/%2e%2e/etc/passwd",
      "/_next/%2e%2e/%2e%2e/secret.txt",
      "/a//b.js",
      "/./index.html",
      "/..%5csecret.txt",
      "/%00.html",
      "/%E0%A4%A",
      "relative.html",
    ]) {
      expect(resolveExportFile(path, spy)).toBeNull();
    }
    expect(looked).toEqual([]);
  });
});
