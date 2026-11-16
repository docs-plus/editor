import { expect, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";

test.describe("identity dialog", () => {
  test("shows inline errors, saves a Persian name and starts fresh on reopen", async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForSync();
    const trigger = page.getByRole("button", { name: /^Edit identity: / });
    await trigger.click();
    const input = page.locator("#user-identity-name");
    const save = page.getByRole("button", { name: "Save" });
    const error = page.locator("#user-identity-name-error");

    await input.fill("   ");
    await save.click();
    await expect(error).toHaveText("Enter a name.");
    await expect(input).toBeFocused();
    await expect(input).toHaveAttribute("aria-invalid", "true");

    await input.fill("a".repeat(33));
    await save.click();
    await expect(error).toHaveText("Use 32 characters or fewer.");

    // Reopening after Esc starts from the saved identity, without the error.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await trigger.click();
    await expect(error).toHaveCount(0);
    await expect(input).not.toHaveValue("a".repeat(33));

    const persian = "\u0639\u0644\u06CC\u200C\u0631\u0636\u0627";
    await input.fill(`  ${persian}  `);
    await save.click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(
      page.getByRole("button", { name: `Edit identity: ${persian}` }),
    ).toBeVisible();
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tinydocy-user") ?? "null"),
    );
    expect(stored.name).toBe(persian);
  });

  test("opens offline once the browser has been idle", async ({
    page,
    context,
  }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await editor.waitForSync();
    // The dialog chunk is fetched on the first idle callback after mount.
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestIdleCallback(() => setTimeout(resolve, 500)),
        ),
    );
    await context.setOffline(true);
    await page.getByRole("button", { name: /^Edit identity: / }).click();
    await expect(page.locator("#user-identity-name")).toBeVisible();
    await context.setOffline(false);
  });
});
