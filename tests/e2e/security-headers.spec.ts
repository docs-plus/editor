import { expect, test } from "@playwright/test";

test.describe("security headers", () => {
  test("root response includes baseline hardening headers", async ({
    page,
  }) => {
    const response = await page.request.get("/");

    expect(response.ok()).toBe(true);
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["referrer-policy"]).toBe(
      "strict-origin-when-cross-origin",
    );

    const csp = response.headers()["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("connect-src");
  });

  test("CSP allows media embed providers by exact host only", async ({
    page,
  }) => {
    const response = await page.request.get("/");
    const csp = response.headers()["content-security-policy"] ?? "";
    const directive = (name: string) =>
      csp
        .split(";")
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${name} `)) ?? "";

    const frameSrc = directive("frame-src");
    for (const host of [
      "https://www.youtube-nocookie.com",
      "https://player.vimeo.com",
      "https://www.loom.com",
      "https://w.soundcloud.com",
      "https://open.spotify.com",
      "https://platform.twitter.com",
    ]) {
      expect(frameSrc).toContain(host);
    }
    expect(frameSrc).not.toMatch(/(^|\s)(https:|\*)(\s|$)/);

    expect(directive("media-src")).toContain("https:");
    expect(directive("connect-src")).toContain("https://publish.x.com");
    expect(directive("script-src")).toContain("https://platform.twitter.com");
  });
});
