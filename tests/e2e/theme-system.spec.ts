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
    await page.goto("/about");

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
