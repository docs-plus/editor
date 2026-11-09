import { expect, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

/** Server HTML only: what crawlers and no-JS visitors receive. */
async function fetchHtml(page: import("@playwright/test").Page, path: string) {
  const response = await page.request.get(path);
  expect(response.ok()).toBe(true);
  return response.text();
}

test.describe("SEO surfaces", () => {
  test("home page server HTML has content, metadata and JSON-LD", async ({
    page,
  }) => {
    const html = await fetchHtml(page, "/");

    expect(html.match(/<h1[\s>]/g)).toHaveLength(1);
    expect(html).toContain("<main");
    expect(html).toMatch(/<link rel="canonical" href="https?:\/\/[^"]+"/);
    expect(html).toContain('property="og:image"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('rel="manifest"');

    const jsonLd = html.match(
      /<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
    )?.[1];
    expect(jsonLd).toBeTruthy();
    const graph = JSON.parse(jsonLd ?? "{}")["@graph"] as Array<{
      "@type": string;
    }>;
    expect(graph.map((node) => node["@type"])).toEqual(
      expect.arrayContaining([
        "Organization",
        "WebSite",
        "WebApplication",
        "SoftwareSourceCode",
      ]),
    );
  });

  test("robots, sitemap, llms.txt and manifest are served", async ({
    page,
  }) => {
    const robots = await fetchHtml(page, "/robots.txt");
    expect(robots).toContain("Disallow: /api/");
    expect(robots).toMatch(/Sitemap: \S+\/sitemap\.xml/);

    const sitemap = await fetchHtml(page, "/sitemap.xml");
    for (const path of ["/about", "/privacy"]) {
      expect(sitemap).toContain(`${path}</loc>`);
    }

    const llms = await page.request.get("/llms.txt");
    expect(llms.headers()["content-type"]).toContain("text/plain");
    const llmsText = await llms.text();
    expect(llmsText.startsWith("# TinyDocy")).toBe(true);
    expect(llmsText).toContain("Public sandbox");

    const manifest = await page.request.get("/manifest.webmanifest");
    expect((await manifest.json()).name).toBe("TinyDocy");

    for (const path of ["/icon", "/apple-icon", "/opengraph-image"]) {
      const image = await page.request.get(path);
      expect(image.headers()["content-type"]).toBe("image/png");
    }
  });

  test("/about answers what TinyDocy is with a visible FAQ", async ({
    page,
  }) => {
    await page.goto("/about");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.locator("table tbody tr")).toHaveCount(6);
    await expect(page.locator("article h3")).toHaveCount(7);
    await expect(page).toHaveTitle(/About \| TinyDocy/);
  });

  test("/privacy discloses the sandbox and analytics choice", async ({
    page,
  }) => {
    await page.goto("/privacy");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacy");
    await expect(page.getByText("Public sandbox:")).toBeVisible();
    await expect(
      page.getByText(/Analytics is not enabled|Google Analytics is/),
    ).toBeVisible();
  });
});

test.describe("live editor", () => {
  test("replaces the intro and keeps one main landmark", async ({ page }) => {
    const editor = new EditorPage(page);
    await editor.goto();

    await expect(page.locator(".site-intro")).toHaveCount(0);
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("main")).toHaveAttribute("data-nosnippet");
    await expect(page.getByRole("tablist")).toHaveAttribute("data-nosnippet");
  });

  test("Tab leaves the formatting toolbar (no keyboard trap)", async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.goto();

    const toolbar = page.getByRole("toolbar", { name: "Formatting" });
    await toolbar.getByRole("button").first().focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      toolbar.locator(":focus"),
      "arrow keys still move inside the toolbar",
    ).toHaveCount(1);

    // Tab walks through the buttons, then must leave (WCAG 2.1.2).
    const buttonCount = await toolbar.getByRole("button").count();
    let left = false;
    for (let i = 0; i <= buttonCount + 1 && !left; i++) {
      await page.keyboard.press("Tab");
      left = !(await toolbar.evaluate((el) =>
        el.contains(document.activeElement),
      ));
    }
    expect(left).toBe(true);
  });

  test("ships no analytics without a measurement ID", async ({ page }) => {
    const googleRequests: string[] = [];
    page.on("request", (request) => {
      if (/google(tagmanager|-analytics)|analytics\.google/.test(request.url()))
        googleRequests.push(request.url());
    });

    const editor = new EditorPage(page);
    await editor.goto();

    await expect(
      page.getByRole("region", { name: "Analytics consent" }),
    ).toHaveCount(0);
    expect(googleRequests).toEqual([]);
    const cookies = await page.context().cookies();
    expect(cookies.filter((c) => c.name.startsWith("_ga"))).toEqual([]);
  });
});
