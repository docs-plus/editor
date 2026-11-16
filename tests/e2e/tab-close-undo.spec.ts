import { expect, type Page, test } from "@playwright/test";

import {
  backdateClosure,
  hasStoredDocument,
  isTombstoned,
  runRetentionPurgeScript,
} from "./helpers/closed-documents";
import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";

const DAY_MS = 86_400_000;

/** Opens a fresh document whose title is `Undo me <nonce>`. */
async function openTitledDoc(
  page: Page,
): Promise<{ id: string; title: string }> {
  // No "x": the editor's typography rule turns "7x2" into "7×2".
  const nonce =
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`.replaceAll(
      "x",
      "y",
    );
  const id = `undo-${nonce}`;
  const title = `Undo me ${nonce}`;
  const ep = new EditorPage(page);
  await ep.goto(id);
  await ep.waitForSync();
  await ep.focusTitle();
  await ep.typeText(title);
  // The tab picks the title up from the document (debounced).
  await expect(page.locator(`[data-tab-id="${id}"]`)).toContainText(title);
  return { id, title };
}

async function tabOrder(page: Page): Promise<string[]> {
  return page
    .locator(".tab-bar [data-tab-id]")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute("data-tab-id") ?? ""),
    );
}

async function closeTab(page: Page, id: string): Promise<void> {
  const tab = page.locator(`[data-tab-id="${id}"]`);
  await tab.hover();
  await tab.getByRole("button", { name: /^Close / }).click();
  await expect(page.locator(`[data-tab-id="${id}"]`)).toHaveCount(0);
}

async function openRecentlyClosed(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Recently closed" }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  await expect(page.getByText("Loading…")).toHaveCount(0);
}

test.describe("closing a tab can be undone", () => {
  test("closing a tab shows Undo, and Undo brings it back with its text", async ({
    page,
  }) => {
    const { id, title } = await openTitledDoc(page);
    const before = await tabOrder(page);

    await closeTab(page, id);
    await expect(page.locator("[data-status-pill]")).toContainText(
      "Closed “Undo me",
    );
    await page.getByRole("button", { name: /^Undo: Closed/ }).click();

    await expect(page.locator(`[data-tab-id="${id}"]`)).toHaveCount(1);
    expect(await tabOrder(page)).toEqual(before);
    await expect(page.locator(".tiptap")).toContainText(title);
  });

  test("text typed just before closing survives Undo", async ({ page }) => {
    const { id } = await openTitledDoc(page);
    await typeInNewParagraphAtEnd(page, "late-marker");

    await closeTab(page, id);
    await page.getByRole("button", { name: /^Undo: Closed/ }).click();

    await expect(page.locator(`[data-tab-id="${id}"]`)).toHaveCount(1);
    await new EditorPage(page).waitForSync();
    await expect(page.locator(".tiptap")).toContainText("late-marker");
  });

  test("Recently closed restores a tab after the pill is gone", async ({
    page,
  }) => {
    const { id, title } = await openTitledDoc(page);
    // Recently closed lists only documents the server has stored.
    await expect.poll(() => hasStoredDocument(id)).toBe(true);

    await closeTab(page, id);
    await page.reload();
    await expect(page.locator(".tab-bar [data-tab-id]").first()).toBeVisible();
    await expect(page.locator(`[data-tab-id="${id}"]`)).toHaveCount(0);

    await openRecentlyClosed(page);
    await expect(
      page.getByText(
        /^Closed tabs are kept for \d+ days\. Anyone using this sandbox can see and restore them\.$/,
      ),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: new RegExp(title) }).click();

    await expect(page.locator(`[data-tab-id="${id}"]`)).toHaveCount(1);
    await new EditorPage(page).waitForSync();
    await expect(page.locator(".tiptap")).toContainText(title);
  });

  test("a closed tab is deleted for good after the closed window", async ({
    page,
  }) => {
    const { id, title } = await openTitledDoc(page);
    await expect.poll(() => hasStoredDocument(id)).toBe(true);

    await closeTab(page, id);
    backdateClosure(id, Date.now() - 8 * DAY_MS);
    // The purge keeps a tab that is still in the stored tab list, and Hocus
    // stores the list's removal after its debounce: run it until it lands.
    await expect
      .poll(
        () => {
          runRetentionPurgeScript();
          return isTombstoned(id);
        },
        { timeout: 20_000 },
      )
      .toBe(true);

    const response = await page.request.post("/api/documents/restore", {
      data: { ids: [id] },
    });
    expect(await response.json()).toEqual({ results: { [id]: "gone" } });

    await openRecentlyClosed(page);
    await expect(
      page.getByRole("menuitem", { name: new RegExp(title) }),
    ).toHaveCount(0);
  });
});
