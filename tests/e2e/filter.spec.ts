import { expect, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

test.describe("heading filter", () => {
  let editorPage: EditorPage;

  test.beforeEach(async ({ page }) => {
    editorPage = new EditorPage(page);
    await editorPage.goto();
    await editorPage.waitForSync();
    await editorPage.buildDocument([
      { level: 1, text: "Test Document" },
      { level: 2, text: "Alpha Section" },
      { level: 2, text: "Beta Section" },
      { level: 2, text: "Gamma Section" },
    ]);
  });

  test("CMD+SHIFT+F opens filter panel", async ({ page }) => {
    await editorPage.openFilter();
    const panel = page.getByRole("search", { name: "Document filter" });
    await expect(panel).toBeVisible({ timeout: 2000 });
  });

  test("typing filter query highlights matches", async ({ page }) => {
    await editorPage.openFilter();
    await editorPage.typeFilter("Alpha");
    await editorPage.commitFilter();

    const highlights = page.locator(".heading-filter-highlight");
    await expect(highlights.first()).toBeVisible({ timeout: 5000 });
  });

  test("a ?filter= link applies the filter once the doc syncs", async ({
    page,
  }) => {
    // The headings must be on the server before the shared link opens.
    await page.waitForFunction(() => {
      const caret = window.__tiptap_editor?.extensionManager.extensions.find(
        (extension) => extension.name === "collaborationCaret",
      );
      const provider = caret?.options.provider as
        | { hasUnsyncedChanges: boolean }
        | undefined;
      return provider !== undefined && !provider.hasUnsyncedChanges;
    });

    await page.goto("/?filter=alpha&mode=or");
    await editorPage.waitForSync();

    const panel = page.getByRole("search", { name: "Document filter" });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Remove filter: alpha" }),
    ).toBeVisible();
    await expect(page.locator(".heading-filter-highlight")).toHaveText("Alpha");
    // The unmatched sections fold away; the match stays open.
    const heading = (text: string) =>
      page.locator(".tiptap h2").filter({ hasText: text });
    await expect(heading("Beta Section")).toHaveClass(/heading-section-folded/);
    await expect(heading("Gamma Section")).toHaveClass(
      /heading-section-folded/,
    );
    await expect(heading("Alpha Section")).not.toHaveClass(
      /heading-section-folded/,
    );
    // The URL keeps describing the filter, and loses it once cleared.
    expect(new URL(page.url()).searchParams.get("filter")).toBe("alpha");

    await panel.getByRole("button", { name: "Clear all filters" }).click();
    await expect
      .poll(() => new URL(page.url()).searchParams.has("filter"))
      .toBe(false);
  });
});
