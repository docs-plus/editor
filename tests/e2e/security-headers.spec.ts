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
});
