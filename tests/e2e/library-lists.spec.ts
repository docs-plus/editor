/**
 * List views (P2.7b) on the library harness (`tests/harness/library`):
 * the keyboard checklist's item 4 (open Trash, restore), the list keys
 * (UX §4.6), ⌘F and the filter bar (metadata only, D24), sort, view and
 * group kept per folder, Manual order, the Tags section with rename and
 * merge (D7), and axe. Runs in the `library` project:
 *   bun tests/harness/library/serve.ts &
 *   bun playwright test --project=library
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

type Snapshot = {
  items: { id: string; title: string; folderId?: string; tagIds?: string[] }[];
  tags: { id: string; name: string }[];
  listViews: Record<string, Record<string, unknown>>;
  trashCount: number;
  trash: { kind: string; id: string }[];
};

const library = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __library: { snapshot(): Snapshot } }
      ).__library.snapshot() as Snapshot,
  );

const grid = (page: Page) => page.getByRole("grid");
const gridRow = (page: Page, key: string) =>
  grid(page).locator(`[role="row"][data-key="${key}"]`);
const files = (page: Page) => page.getByRole("navigation", { name: "Files" });

async function rowKeys(page: Page): Promise<string[]> {
  return grid(page)
    .locator('[role="row"][data-key]')
    .evaluateAll((rows) =>
      rows
        .map((row) => ({
          key: row.getAttribute("data-key") ?? "",
          index: Number(row.getAttribute("aria-rowindex")),
        }))
        .sort((a, b) => a.index - b.index)
        .map((row) => row.key),
    );
}

async function focusedKey(page: Page): Promise<string | null> {
  return page.evaluate(
    () =>
      (document.activeElement as HTMLElement | null)?.getAttribute(
        "data-key",
      ) ?? null,
  );
}

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element === document.activeElement);
}

async function tabTo(page: Page, locator: Locator, back = false) {
  for (let i = 0; i < 60; i++) {
    if (await isFocused(locator)) return;
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
  }
  throw new Error("tabTo: never reached the element");
}

/** Opens a sidebar section with the keyboard, so its list takes focus. */
async function openSection(page: Page, name: string | RegExp) {
  await tabTo(page, files(page).getByRole("button", { name }).first());
  await page.keyboard.press("Enter");
  await expect(grid(page)).toBeVisible();
}

const FOLDER_PATHS: Record<string, string[]> = {
  "folder:f-q4": ["folder:f-work", "folder:f-q4"],
  "folder:f-work": ["folder:f-work"],
};

/** Clicks down the tree to a folder, which shows its list. */
async function openFolder(page: Page, key: string) {
  const tree = page.getByRole("tree", { name: "Library" });
  for (const step of FOLDER_PATHS[key] ?? [key]) {
    await tree
      .locator(`[role="treeitem"][data-key="${step}"] .lib-row`)
      .click();
  }
  await expect(grid(page)).toBeVisible();
}

const list = (page: Page) => page.getByTestId("place");

test.describe("list views (P2.7b)", () => {
  test("item 4: open Trash with the keyboard and restore", async ({ page }) => {
    await page.goto("/?trash=1");
    await expect.poll(async () => (await library(page)).trashCount).toBe(3);
    await openSection(page, /^Trash/);
    await expect(page.getByRole("heading", { name: "Trash" })).toBeVisible();
    // Newest first: the folder "Old" went last.
    expect(await rowKeys(page)).toEqual([
      "trash:folder:f-old",
      "trash:doc:d-cafe",
      "trash:doc:d-untitled",
    ]);
    await expect.poll(() => focusedKey(page)).toBe("trash:folder:f-old");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedKey(page)).toBe("trash:doc:d-cafe");
    await page.keyboard.press("Shift+F10");
    await expect
      .poll(() =>
        page.evaluate(() => !!document.activeElement?.closest('[role="menu"]')),
      )
      .toBe(true);
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Restore" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("pill")).toContainText(
      "Restored “Café menu” to Personal.",
    );
    await expect.poll(async () => (await library(page)).trashCount).toBe(2);
    expect(await rowKeys(page)).toEqual([
      "trash:folder:f-old",
      "trash:doc:d-untitled",
    ]);
    // Focus stays in the list, on the next row.
    await expect.poll(() => focusedKey(page)).toBe("trash:doc:d-untitled");
    await expect(
      page.getByText("Documents in Trash are deleted after 30 days."),
    ).toBeVisible();
  });

  test("the empty Trash says so", async ({ page }) => {
    await page.goto("/");
    await files(page)
      .getByRole("button", { name: /^Trash/ })
      .click();
    await expect(page.getByText("Trash is empty")).toBeVisible();
    await expect(
      page.getByText("Documents you delete stay here for 30 days."),
    ).toBeVisible();
  });

  test("list keys: arrows, Enter opens, Shift extends, ⌘A, trash and undo", async ({
    page,
  }) => {
    await page.goto("/");
    await openFolder(page, "folder:f-q4");
    await grid(page).locator('[role="row"][data-key]').first().focus();
    expect(await rowKeys(page)).toEqual([
      "folder:f-drafts",
      "doc:d-plan",
      "doc:d-retro",
    ]);
    await page.keyboard.press("End");
    await expect.poll(() => focusedKey(page)).toBe("doc:d-retro");
    await page.keyboard.press("Shift+ArrowUp");
    await expect(gridRow(page, "doc:d-plan")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(gridRow(page, "doc:d-retro")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("ControlOrMeta+a");
    await expect(gridRow(page, "folder:f-drafts")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.keyboard.press("Escape");
    await expect(gridRow(page, "doc:d-plan")).toHaveAttribute(
      "aria-selected",
      "false",
    );
    await page.keyboard.press("Home");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+Backspace" : "Delete",
    );
    await expect(page.getByTestId("pill")).toContainText(
      "Moved “Q4 plan” to Trash.",
    );
    await expect.poll(() => focusedKey(page)).toBe("doc:d-retro");
    await page.keyboard.press("ControlOrMeta+z");
    await expect(gridRow(page, "doc:d-plan")).toBeVisible();
    // Enter on a folder row shows its list with focus on its first row.
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "Drafts" })).toBeVisible();
    await expect.poll(() => focusedKey(page)).toBe("folder:f-old");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("last-open")).toHaveText("d-ideas current");
  });

  test("F2 renames in the list; type-to-select finds a row", async ({
    page,
  }) => {
    await page.goto("/");
    await files(page)
      .getByRole("button", { name: "Library", exact: true })
      .click();
    await grid(page).locator('[role="row"][data-key]').first().focus();
    await page.keyboard.type("me");
    await expect.poll(() => focusedKey(page)).toBe("doc:d-meeting");
    await page.keyboard.press("F2");
    const field = page.getByRole("textbox", { name: "Title", exact: true });
    await expect(field).toBeFocused();
    await field.fill("Minutes");
    await page.keyboard.press("Enter");
    await expect.poll(() => focusedKey(page)).toBe("doc:d-meeting");
    expect(
      (await library(page)).items.find((item) => item.id === "d-meeting")
        ?.title,
    ).toBe("Minutes");
  });

  test("⌘F filters the focused list by title, tag and folder, not body text", async ({
    page,
  }) => {
    await page.goto("/");
    await files(page)
      .getByRole("button", { name: "Recent", exact: true })
      .click();
    await grid(page).locator('[role="row"][data-key]').first().focus();
    await page.keyboard.press("ControlOrMeta+f");
    const filter = page.getByRole("textbox", {
      name: "Filter by title, tag or folder",
    });
    await expect(filter).toBeFocused();
    await filter.fill("FINANCE");
    await expect
      .poll(() => rowKeys(page))
      .toEqual(["doc:d-plan", "doc:d-budget"]);
    await expect(page.locator(".lib-list-count")).toHaveText("2 of 4");
    await filter.fill("q4");
    // "Q4 retro notes" by title, "Q4 plan" by title; folder Q4 matches both.
    await expect
      .poll(() => rowKeys(page))
      .toEqual(["doc:d-plan", "doc:d-retro"]);
    await filter.fill("quarter");
    // Only the snippet says "quarter": no match (D24).
    await expect(page.getByText("No matches")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(filter).toHaveValue("");
    await page.keyboard.press("ArrowDown");
    await expect.poll(() => focusedKey(page)).not.toBeNull();
    // ⌘F outside a list is not the list's.
    await page.getByTestId("last-open").click();
  });

  test("the tag filter combines tags with AND", async ({ page }) => {
    await page.goto("/");
    await files(page)
      .getByRole("button", { name: "Recent", exact: true })
      .click();
    await list(page).getByRole("button", { name: "Tags" }).click();
    await page.getByRole("menuitemcheckbox", { name: "finance" }).click();
    await page.keyboard.press("Escape");
    await expect
      .poll(() => rowKeys(page))
      .toEqual(["doc:d-plan", "doc:d-budget"]);
    await list(page).getByRole("button", { name: "Tags (1)" }).click();
    await page.getByRole("menuitemcheckbox", { name: "planning" }).click();
    await page.keyboard.press("Escape");
    await expect.poll(() => rowKeys(page)).toEqual(["doc:d-plan"]);
    await page
      .getByRole("button", { name: "Remove tag filter planning" })
      .click();
    await expect
      .poll(() => rowKeys(page))
      .toEqual(["doc:d-plan", "doc:d-budget"]);
  });

  test("sort, view and group are kept per folder", async ({ page }) => {
    await page.goto("/");
    await openFolder(page, "folder:f-q4");
    await page
      .getByRole("columnheader", { name: "Modified" })
      .getByRole("button")
      .click();
    await expect(
      page.getByRole("columnheader", { name: /Modified/ }),
    ).toHaveAttribute("aria-sort", "descending");
    expect(await rowKeys(page)).toEqual([
      "folder:f-drafts",
      "doc:d-plan",
      "doc:d-retro",
    ]);
    await page.getByRole("button", { name: "View options" }).click();
    await page.getByRole("menuitemradio", { name: "Preview" }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator(".lib-list")).toHaveAttribute(
      "data-view",
      "preview",
    );
    await expect(page.getByText("Goals for the quarter")).toBeVisible();

    await openFolder(page, "folder:f-work");
    await expect(page.locator(".lib-list")).toHaveAttribute(
      "data-view",
      "list",
    );
    await expect(
      page.getByRole("columnheader", { name: /Name/ }),
    ).toHaveAttribute("aria-sort", "ascending");

    await openFolder(page, "folder:f-q4");
    await expect(page.locator(".lib-list")).toHaveAttribute(
      "data-view",
      "preview",
    );
    expect((await library(page)).listViews["folder:f-q4"]).toEqual({
      sort: "modified",
      descending: true,
      view: "preview",
    });
  });

  test("groups by date", async ({ page }) => {
    await page.goto("/");
    await files(page)
      .getByRole("button", { name: "Library", exact: true })
      .click();
    await page.getByRole("button", { name: "View options" }).click();
    await page.getByRole("menuitemradio", { name: "By date" }).click();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("rowheader", { name: "Folders" }),
    ).toBeVisible();
    await expect(page.getByRole("rowheader", { name: "Today" })).toBeVisible();
    await expect(
      page.getByRole("rowheader", { name: "Earlier" }),
    ).toBeVisible();
  });

  test("Manual order: ⌥⌘↓ moves a document, and ⌘Z puts it back", async ({
    page,
  }) => {
    await page.goto("/");
    await openFolder(page, "folder:f-q4");
    await page.getByRole("button", { name: "View options" }).click();
    await page.getByRole("menuitemradio", { name: "Manual" }).click();
    await page.keyboard.press("Escape");
    expect(await rowKeys(page)).toEqual([
      "folder:f-drafts",
      "doc:d-plan",
      "doc:d-retro",
    ]);
    await gridRow(page, "doc:d-plan").focus();
    await page.keyboard.press(
      process.platform === "darwin"
        ? "Meta+Alt+ArrowDown"
        : "Control+Alt+ArrowDown",
    );
    await expect
      .poll(() => rowKeys(page))
      .toEqual(["folder:f-drafts", "doc:d-retro", "doc:d-plan"]);
    await expect.poll(() => focusedKey(page)).toBe("doc:d-plan");
    await page.keyboard.press("ControlOrMeta+z");
    await expect
      .poll(() => rowKeys(page))
      .toEqual(["folder:f-drafts", "doc:d-plan", "doc:d-retro"]);
    // The tree keeps sorting by title (details §6.3).
    const tree = page.getByRole("tree", { name: "Library" });
    await expect(tree.locator('[data-key="doc:d-plan"]')).toBeVisible();
  });

  test("Tags section: collapsed, opens a tag's list, F2 renames, merge asks", async ({
    page,
  }) => {
    await page.goto("/");
    const toggle = files(page).getByRole("button", { name: "Tags" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await toggle.click();
    const tagRow = (name: string) =>
      files(page).getByRole("list", { name: "Tags" }).getByRole("button", {
        name,
        exact: true,
      });
    await tagRow("finance").click();
    await expect(page.getByRole("heading", { name: "finance" })).toBeVisible();
    await expect
      .poll(() => rowKeys(page))
      .toEqual(["doc:d-budget", "doc:d-plan"]);

    // Rename everywhere at once.
    await tagRow("finance").focus();
    await page.keyboard.press("F2");
    const field = page.getByRole("textbox", { name: "Tag name" });
    await field.fill("money");
    await page.keyboard.press("Enter");
    await expect(tagRow("money")).toBeFocused();
    await expect(page.getByRole("heading", { name: "money" })).toBeVisible();

    // A taken name asks to merge; Cancel has focus.
    await page.keyboard.press("F2");
    await page.getByRole("textbox", { name: "Tag name" }).fill("PLANNING");
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("alertdialog");
    await expect(sheet).toContainText("Merge “money” into “planning”?");
    await expect(sheet).toContainText("2 documents will have “planning”.");
    await expect(sheet.getByRole("button", { name: "Cancel" })).toBeFocused();
    await sheet.getByRole("button", { name: "Merge" }).click();
    await expect(page.getByTestId("pill")).toContainText(
      "Merged “money” into “planning”.",
    );
    const snapshot = await library(page);
    expect(snapshot.tags.map((tag) => tag.name).sort()).toEqual([
      "planning",
      "plans",
      "سفر",
    ]);
    expect(
      snapshot.items.find((item) => item.id === "d-budget")?.tagIds,
    ).toEqual(["t-planning"]);
    await expect(tagRow("planning")).toBeFocused();
  });

  test("lists pass axe in both themes and right to left", async ({ page }) => {
    for (const query of ["", "?theme=dark", "?dir=rtl"]) {
      await page.goto(`/${query}`);
      await files(page)
        .getByRole("button", { name: "Recent", exact: true })
        .click();
      await page.getByRole("button", { name: "View options" }).click();
      await page.getByRole("menuitemradio", { name: "Preview" }).click();
      await page.keyboard.press("Escape");
      await grid(page).locator('[role="row"][data-key]').first().focus();
      const result = await new AxeBuilder({ page })
        .include(".lib-list")
        .analyze();
      expect(result.violations, query).toEqual([]);
    }
  });
});
