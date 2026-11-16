/**
 * F3: System theme on the web (preferences spec C11, §5.6). New browsers
 * follow the OS from the first frame and live as it changes; browsers that
 * used TinyDocy before keep Light. Never uses `window.__tiptap_editor`, so
 * it also runs against a production build (`E2E_BASE_URL`).
 */
import { expect, type Page, test } from "@playwright/test";

const LIGHT = "#fafafa";
const DARK = "#171717";
const KEY = "tinydocy-theme";

const html = (page: Page) => page.locator("html");
/** Browsers use the first theme-color meta in tree order. */
const themeColor = (page: Page) =>
  page.locator('meta[name="theme-color"]').first();
const stored = (page: Page) =>
  page.evaluate((key) => localStorage.getItem(key), KEY);
const row = (page: Page) =>
  page.locator('[role="toolbar"][data-variant="fixed"]');

/**
 * Opens the editor as a new visitor: a per-test global-tabs doc and no
 * seeded `tinydocy-tabs` (a legacy key, which would mean Light).
 */
async function openEditorAsNewVisitor(page: Page): Promise<void> {
  const tabsDoc = `global-tabs-theme-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await page.addInitScript((name: string) => {
    (window as Window & { __GLOBAL_TABS_DOC?: string }).__GLOBAL_TABS_DOC =
      name;
  }, tabsDoc);
  await page.goto("/");
  await page.locator("[data-server-synced]").first().waitFor();
  await page.locator(".tiptap").first().waitFor();
}

test.describe("System theme", () => {
  test("new visitor, OS dark: dark from the first frame", async ({ page }) => {
    const messages: string[] = [];
    page.on("console", (message) => messages.push(message.text()));
    await page.addInitScript(() => {
      requestAnimationFrame(() => {
        (window as Window & { __firstFrameDark?: boolean }).__firstFrameDark =
          document.documentElement.classList.contains("dark");
      });
    });
    await page.emulateMedia({ colorScheme: "dark" });
    // Chromium may render once <body> exists, and a loaded parser can yield
    // before the body's first script (seen on a busy CI runner). A 20× CPU
    // throttle makes that frame likely, so the boot script must run in
    // <head>, before <body> is inserted.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 20 });
    await page.goto("/about");
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __firstFrameDark?: boolean })
              .__firstFrameDark,
        ),
      )
      .toBe(true);
    await expect(html(page)).toHaveClass(/\bdark\b/);
    await expect(themeColor(page)).toHaveAttribute("content", DARK);
    expect(await stored(page)).toBe("system");
    expect(
      messages.filter((text) => /hydrat|did not match/i.test(text)),
    ).toEqual([]);
  });

  test("the boot script runs in <head>, before rendering can start", async ({
    page,
  }) => {
    const source = await (await page.request.get("/about")).text();
    const boot = source.indexOf('var k="tinydocy-theme"');
    expect(boot).toBeGreaterThan(-1);
    expect(boot).toBeLessThan(source.indexOf("</head>"));
  });

  test("new visitor, OS light: light, stored system", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/about");
    await expect(html(page)).not.toHaveClass(/\bdark\b/);
    await expect(themeColor(page)).toHaveAttribute("content", LIGHT);
    expect(await stored(page)).toBe("system");
  });

  test("legacy browser stays light", async ({ page }) => {
    await page.addInitScript(() => {
      if (!localStorage.getItem("tinydocy-user")) {
        localStorage.setItem("tinydocy-user", JSON.stringify({ name: "Ada" }));
      }
    });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/about");
    await expect(html(page)).not.toHaveClass(/\bdark\b/);
    await expect(themeColor(page)).toHaveAttribute("content", LIGHT);
    expect(await stored(page)).toBe("light");
  });

  test("System follows OS changes live", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openEditorAsNewVisitor(page);
    const toLight = row(page).getByRole("button", {
      name: "Switch to light mode",
    });
    const toDark = row(page).getByRole("button", {
      name: "Switch to dark mode",
    });

    await expect(html(page)).not.toHaveClass(/\bdark\b/);
    await expect(toDark).toBeVisible();

    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html(page)).toHaveClass(/\bdark\b/);
    await expect(themeColor(page)).toHaveAttribute("content", DARK);
    await expect(toLight).toBeVisible();

    await page.emulateMedia({ colorScheme: "light" });
    await expect(html(page)).not.toHaveClass(/\bdark\b/);
    await expect(themeColor(page)).toHaveAttribute("content", LIGHT);
    await expect(toDark).toBeVisible();
    expect(await stored(page)).toBe("system");
  });

  test("⋯ › Appearance › System returns to following the OS", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openEditorAsNewVisitor(page);

    await row(page)
      .getByRole("button", { name: "Switch to dark mode" })
      .click();
    await expect(html(page)).toHaveClass(/\bdark\b/);
    expect(await stored(page)).toBe("dark");

    // An explicit Dark ignores the OS.
    await page.emulateMedia({ colorScheme: "dark" });
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html(page)).toHaveClass(/\bdark\b/);

    await row(page).getByRole("button", { name: "More formatting" }).click();
    await page.getByRole("menuitem", { name: "Appearance" }).click();
    const system = page.getByRole("menuitemradio", { name: "System" });
    await expect(
      page.getByRole("menuitemradio", { name: "Dark" }),
    ).toBeChecked();
    await system.click();

    await expect(html(page)).not.toHaveClass(/\bdark\b/);
    await expect(themeColor(page)).toHaveAttribute("content", LIGHT);
    expect(await stored(page)).toBe("system");

    // Following the OS again, both ways.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html(page)).toHaveClass(/\bdark\b/);
    await expect(themeColor(page)).toHaveAttribute("content", DARK);
    await page.emulateMedia({ colorScheme: "light" });
    await expect(html(page)).not.toHaveClass(/\bdark\b/);
    await expect(themeColor(page)).toHaveAttribute("content", LIGHT);
  });

  test("palette Switch theme flips the theme", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openEditorAsNewVisitor(page);
    await expect(html(page)).not.toHaveClass(/\bdark\b/);

    await page.locator(".tiptap").first().click();
    await page.keyboard.press("Alt+Slash");
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    await page.keyboard.type("Switch theme");
    await page.keyboard.press("Enter");

    await expect(html(page)).toHaveClass(/\bdark\b/);
    expect(await stored(page)).toBe("dark");
  });
});

test.describe("System theme on a phone (375 px)", () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 375, height: 812 },
  });

  const sheet = (page: Page) =>
    page.getByRole("dialog", { name: "Text format" });

  test("the Aa sheet's theme button cycles System → Light → Dark → System", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await openEditorAsNewVisitor(page);
    // Next's dev indicator sits over the bar and eats taps.
    await page.addStyleTag({
      content: "nextjs-portal { display: none !important; }",
    });
    await page.locator(".tiptap h1").first().tap();
    await page
      .getByRole("toolbar", { name: "Formatting" })
      .getByRole("button", { name: "Text format" })
      .tap();
    await sheet(page).getByRole("button", { name: "Heading 1" }).waitFor();

    const toggle = (name: string) =>
      sheet(page).getByRole("button", { name, exact: true });
    /** The visible label fits its half-width cell (no ellipsis). */
    const expectNotClipped = async (name: string) =>
      expect(
        await toggle(name)
          .locator("span")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);

    const fromSystem = toggle("Theme: System, switch to light mode");
    await expect(fromSystem).toHaveText("Switch to light mode");
    await expectNotClipped("Theme: System, switch to light mode");
    await fromSystem.tap();
    expect(await stored(page)).toBe("light");
    await expect(html(page)).not.toHaveClass(/\bdark\b/);

    const fromLight = toggle("Theme: Light, switch to dark mode");
    await expect(fromLight).toHaveText("Switch to dark mode");
    await expectNotClipped("Theme: Light, switch to dark mode");
    await fromLight.tap();
    expect(await stored(page)).toBe("dark");
    await expect(html(page)).toHaveClass(/\bdark\b/);

    const fromDark = toggle("Theme: Dark, use system theme");
    await expect(fromDark).toHaveText("Use system theme");
    await expectNotClipped("Theme: Dark, use system theme");
    await fromDark.tap();
    expect(await stored(page)).toBe("system");
    await expect(html(page)).not.toHaveClass(/\bdark\b/);
    await expect(toggle("Theme: System, switch to light mode")).toBeVisible();

    // Back on System, the OS drives it again.
    await page.emulateMedia({ colorScheme: "dark" });
    await expect(html(page)).toHaveClass(/\bdark\b/);
  });
});
