/**
 * `/privacy` is a web page only (#101): desktop builds link to the website's
 * copy in a new window, which is never prefetched; the web keeps its
 * prefetched in-app link.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

type LinkModule = typeof import("@/components/site-page/privacy-link");

async function renderLink(className?: string): Promise<HTMLAnchorElement> {
  const { PrivacyLink } = await importFresh<LinkModule>(
    "@/components/site-page/privacy-link",
  );
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(PrivacyLink, { className }),
  );
  const anchor = host.querySelector("a");
  if (!anchor) throw new Error("no link rendered");
  return anchor;
}

afterEach(() => {
  delete process.env.NEXT_PUBLIC_APP_TARGET;
  resetModules();
});

describe("PrivacyLink", () => {
  it("web: the in-app /privacy page, same window (unchanged)", async () => {
    const link = await renderLink("underline");
    expect(link.getAttribute("href")).toBe("/privacy");
    expect(link.hasAttribute("target")).toBe(false);
    expect(link.textContent).toBe("Privacy");
    expect(link.className).toBe("underline");
  });

  it("desktop: the website's privacy page, in a new window", async () => {
    process.env.NEXT_PUBLIC_APP_TARGET = "desktop";
    const link = await renderLink("underline");
    expect(link.getAttribute("href")).toBe("https://tiny.docs.plus/privacy");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(link.textContent).toBe("Privacy");
    expect(link.className).toBe("underline");
  });

  it("is the only link to /privacy in the app", () => {
    const linkers = [
      "components/site-page/site-page.tsx",
      "components/tiptap-ui/user-identity-button.tsx",
      "components/analytics/google-analytics.tsx",
    ];
    for (const file of linkers) {
      const source = readFileSync(file, "utf8");
      expect({ file, uses: source.includes("<PrivacyLink") }).toEqual({
        file,
        uses: true,
      });
    }
    const glob = new Bun.Glob("{app,components,hooks,lib}/**/*.{ts,tsx}");
    const direct = [...glob.scanSync(".")].filter(
      (file) =>
        file !== "components/site-page/privacy-link.tsx" &&
        /href=(?:"|\{\s*["'`])\/privacy\b/.test(readFileSync(file, "utf8")),
    );
    expect(direct).toEqual([]);
  });
});
