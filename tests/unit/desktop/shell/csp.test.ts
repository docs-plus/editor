import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";

import {
  buildDesktopCsp,
  DESKTOP_FRAME_HOSTS,
  hashInline,
  sha256Source,
} from "@/desktop/main/csp";

const directives = (csp: string) =>
  Object.fromEntries(
    csp.split("; ").map((d) => {
      const [name, ...values] = d.split(" ");
      return [name, values];
    }),
  ) as Record<string, string[]>;

describe("desktop CSP", () => {
  test("hashes every inline script and style, but not external scripts", () => {
    const html =
      '<script src="/a.js"></script><script>self.x=1</script><script id="j">y()</script><style>p{}</style>';
    const hashes = hashInline(html);
    const hash = (t: string) =>
      `'sha256-${createHash("sha256").update(t).digest("base64")}'`;
    expect(hashes.scripts).toEqual([hash("self.x=1"), hash("y()")]);
    expect(hashes.styles).toEqual([hash("p{}")]);
  });

  test("no unsafe-inline scripts, no blob or data images, no X hosts", () => {
    const csp = directives(
      buildDesktopCsp({
        syncUrl: "wss://ws.example.test",
        hashes: { scripts: [sha256Source("a")], styles: [] },
        runtimeStyleHashes: [sha256Source("tiptap")],
      }),
    );
    expect(csp["script-src"]).toEqual(["'self'", sha256Source("a")]);
    expect(csp["style-src-elem"]).toEqual(["'self'", sha256Source("tiptap")]);
    expect(csp["style-src-attr"]).toEqual(["'unsafe-inline'"]);
    expect(csp["img-src"]).toEqual(["'self'"]);
    expect(csp["connect-src"]).toEqual(["'self'", "wss://ws.example.test"]);
    expect(csp["object-src"]).toEqual(["'none'"]);
    expect(csp["frame-ancestors"]).toEqual(["'none'"]);
    const all = Object.values(csp).flat().join(" ");
    expect(all).not.toContain("blob:");
    expect(all).not.toContain("data:");
    expect(all).not.toContain("twitter");
    expect(csp["script-src"]).not.toContain("'unsafe-inline'");
    expect(DESKTOP_FRAME_HOSTS).toContain("https://www.youtube-nocookie.com");
  });
});
