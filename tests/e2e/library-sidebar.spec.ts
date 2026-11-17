/**
 * The files sidebar (P2.7a) on its Bun harness (`tests/harness/library`):
 * the keyboard checklist (plan §5.6, UX §8.3 items 1, 2, 3, 8 and 12),
 * folder-into-itself refusals, the 4-level rule, drag and drop, RTL and
 * axe. Runs in the `library` project:
 *   bun tests/harness/library/serve.ts &
 *   bun playwright test --project=library
 * Every flow below the "pointer" block uses the keyboard only.
 */
import AxeBuilder from "@axe-core/playwright";
import { expect, type Locator, type Page, test } from "@playwright/test";

type Snapshot = {
  items: {
    id: string;
    title: string;
    folderId?: string | null;
    pinKey?: string;
  }[];
  folders: { id: string; name: string; parentId: string | null }[];
  trashCount: number;
};

const library = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as { __library: { snapshot(): Snapshot } }
      ).__library.snapshot() as Snapshot,
  );

const tree = (page: Page) => page.getByRole("tree", { name: "Library" });
const row = (page: Page, key: string) =>
  tree(page).locator(`[role="treeitem"][data-key="${key}"]`);

async function activeKey(page: Page): Promise<string | null> {
  return page.evaluate(
    () => (document.activeElement as HTMLElement | null)?.dataset.key ?? null,
  );
}

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((element) => element === document.activeElement);
}

/** Presses Tab (or Shift+Tab) until `locator` has focus. */
async function tabTo(page: Page, locator: Locator, back = false) {
  for (let i = 0; i < 40; i++) {
    if (await isFocused(locator)) return;
    await page.keyboard.press(back ? "Shift+Tab" : "Tab");
  }
  throw new Error("tabTo: never reached the element");
}

/** F6 until focus is in the Files region. */
async function f6ToSidebar(page: Page) {
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("F6");
    const inFiles = await page.evaluate(
      () => !!document.activeElement?.closest('nav[aria-label="Files"]'),
    );
    if (inFiles) return;
  }
  throw new Error("F6 never reached the sidebar");
}

/** Type-ahead in the tree to a row whose label starts with `text`. */
async function typeTo(page: Page, text: string, key: string) {
  await page.keyboard.type(text);
  await expect.poll(() => activeKey(page)).toBe(key);
  // Let the type-ahead buffer lapse before the next key.
  await page.waitForTimeout(650);
}

/** ⌘O / Ctrl+O, then waits for the field to take focus. */
async function openQuickOpen(page: Page) {
  await page.keyboard.press("ControlOrMeta+o");
  await expect(page.getByRole("combobox")).toBeFocused();
}

/** Shift+F10, then waits for the menu to take focus. */
async function openRowMenu(page: Page) {
  await page.keyboard.press("Shift+F10");
  await expect
    .poll(() =>
      page.evaluate(() => !!document.activeElement?.closest('[role="menu"]')),
    )
    .toBe(true);
}

/** Arrows through an open menu to `label`, then Enter. */
async function chooseMenuItem(page: Page, label: string) {
  await expect(page.getByRole("menu")).toBeVisible();
  for (let i = 0; i < 14; i++) {
    const text = await page.evaluate(() =>
      document.activeElement?.getAttribute("role") === "menuitem"
        ? (document.activeElement.textContent ?? "")
        : "",
    );
    if (text.startsWith(label)) {
      await page.keyboard.press("Enter");
      return;
    }
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(`menu item ${label} not reached`);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(tree(page)).toBeVisible();
});

test.describe("keyboard checklist (plan §5.6, UX §8.3)", () => {
  test("F6 moves between regions; focus returns to the last row", async ({
    page,
  }) => {
    await f6ToSidebar(page);
    expect(await activeKey(page)).toBe("folder:f-archive");
    await expect(page.locator('nav[aria-label="Files"]')).toHaveAttribute(
      "data-region-flash",
      "",
    );
    // Enter opens; focus goes to the document.
    await page.keyboard.press("End");
    expect(await activeKey(page)).toBe("doc:d-fa");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "Document" })).toBeFocused();

    await page.keyboard.press("F6");
    await expect(
      page
        .getByRole("toolbar", { name: "Open documents" })
        .getByRole("button")
        .first(),
    ).toBeFocused();
    await page.keyboard.press("F6");
    expect(await activeKey(page)).toBe("doc:d-fa");
    await page.keyboard.press("F6");
    await expect(page.getByRole("textbox", { name: "Document" })).toBeFocused();
    await page.keyboard.press("Shift+F6");
    expect(await activeKey(page)).toBe("doc:d-fa");
  });

  test("item 1: create a document, title it, create a folder, Move to… it", async ({
    page,
  }) => {
    await f6ToSidebar(page);
    await tabTo(page, page.getByRole("button", { name: "New Document" }), true);
    await page.keyboard.press("Enter");
    const title = page.getByTestId("doc-title");
    await expect(title).toBeFocused();
    await page.keyboard.type("Trip plan");

    await f6ToSidebar(page);
    await tabTo(page, page.getByRole("button", { name: "New Folder" }), true);
    await page.keyboard.press("Enter");
    const name = page.getByRole("textbox", { name: "Folder name" });
    await expect(name).toBeFocused();
    await page.keyboard.type("Trips");
    await page.keyboard.press("Enter");
    const folder = (await library(page)).folders.find(
      (f) => f.name === "Trips",
    );
    if (!folder) throw new Error("no Trips folder");
    expect(await activeKey(page)).toBe(`folder:${folder.id}`);

    const doc = (await library(page)).items.find(
      (d) => d.title === "Trip plan",
    );
    if (!doc) throw new Error("no Trip plan");
    await typeTo(page, "trip p", `doc:${doc.id}`);
    await openRowMenu(page);
    await chooseMenuItem(page, "Move to…");
    const dialog = page.getByRole("dialog", { name: "Move “Trip plan”" });
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByRole("textbox", { name: "Filter folders" }),
    ).toBeFocused();
    await page.keyboard.type("trips");
    await page.keyboard.press("ArrowDown");
    await expect(dialog.getByRole("treeitem", { name: "Trips" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();

    const moved = (await library(page)).items.find((d) => d.id === doc.id);
    expect(moved?.folderId).toBe(folder.id);
    await expect(page.getByTestId("pill")).toContainText(
      "Moved “Trip plan” to Trips.",
    );
    // Focus returns to the moved row, revealed inside its folder.
    await expect.poll(() => activeKey(page)).toBe(`doc:${doc.id}`);
    await expect(row(page, `folder:${folder.id}`)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("item 2: F2 renames in place; Esc cancels; an empty name is refused", async ({
    page,
  }) => {
    await f6ToSidebar(page);
    await typeTo(page, "meeting", "doc:d-meeting");
    await page.keyboard.press("F2");
    const field = page.getByRole("textbox", { name: "Title" });
    await expect(field).toBeFocused();
    await expect(field).toHaveValue("Meeting notes");
    await page.keyboard.press("Escape");
    expect(await activeKey(page)).toBe("doc:d-meeting");

    await page.keyboard.press("F2");
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toHaveText("Enter a title.");
    await expect(field).toBeFocused();
    await page.keyboard.type("Standup notes");
    await page.keyboard.press("Enter");
    await expect.poll(() => activeKey(page)).toBe("doc:d-meeting");
    await expect(row(page, "doc:d-meeting")).toContainText("Standup notes");
    const snap = await library(page);
    expect(snap.items.find((d) => d.id === "d-meeting")?.title).toBe(
      "Standup notes",
    );
  });

  test("item 3: Move to Trash, then ⌘Z in the tree brings it back", async ({
    page,
  }) => {
    await f6ToSidebar(page);
    await typeTo(page, "budget", "doc:d-budget");
    await page.keyboard.press("Delete");
    await expect(row(page, "doc:d-budget")).toHaveCount(0);
    await expect(page.getByTestId("pill")).toContainText(
      "Moved “Budget 2026” to Trash.",
    );
    // Focus moves to the next row.
    await expect.poll(() => activeKey(page)).toBe("doc:d-meeting");
    expect((await library(page)).trashCount).toBe(1);

    await page.keyboard.press("ControlOrMeta+z");
    await expect(row(page, "doc:d-budget")).toHaveCount(1);
    await expect.poll(() => activeKey(page)).toBe("doc:d-budget");
    expect((await library(page)).trashCount).toBe(0);
  });

  test("a folder goes to Trash with its documents, and comes back whole", async ({
    page,
  }) => {
    await f6ToSidebar(page);
    await typeTo(page, "work", "folder:f-work");
    await page.keyboard.press("Delete");
    await expect(page.getByTestId("pill")).toContainText(
      "Moved “Work” and 5 documents to Trash.",
    );
    expect((await library(page)).trashCount).toBe(5);
    await page.keyboard.press("ControlOrMeta+z");
    await expect(row(page, "folder:f-work")).toHaveCount(1);
    expect((await library(page)).trashCount).toBe(0);
  });

  test("item 8: Quick Open ignores accents; ⌘Enter opens a new tab; Esc returns focus", async ({
    page,
  }) => {
    await f6ToSidebar(page);
    await typeTo(page, "meeting", "doc:d-meeting");
    await openQuickOpen(page);
    await page.keyboard.press("Escape");
    await expect.poll(() => activeKey(page)).toBe("doc:d-meeting");

    await openQuickOpen(page);
    await page.keyboard.type("cafe");
    const option = page.getByRole("option", { name: /^Café menu/ });
    await expect(option).toBeVisible();
    await expect(option.locator("mark")).toHaveText("Café");
    await page.keyboard.press("ControlOrMeta+Enter");
    await expect(page.getByTestId("last-open")).toHaveText("d-cafe tab");

    // Persian and Arabic letters and digits fold together.
    await openQuickOpen(page);
    await page.keyboard.type("كتاب");
    await expect(
      page.getByRole("option", { name: /^كتاب الطبخ/ }),
    ).toBeVisible();
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("1403");
    await expect(
      page.getByRole("option", { name: /^گزارش سالانه/ }),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // No match: Create, and what search looks at.
    await openQuickOpen(page);
    await page.keyboard.type("zebra crossing");
    await expect(page.getByRole("option", { name: /Create/ })).toBeVisible();
    await expect(
      page.getByText(
        "Search looks at titles, tags and folders, not inside documents.",
      ),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("doc-title")).toHaveValue("zebra crossing");
  });

  test("item 12: Shift+F10 opens the row menu; Pin adds it to Pinned", async ({
    page,
  }) => {
    await f6ToSidebar(page);
    await typeTo(page, "meeting", "doc:d-meeting");
    await openRowMenu(page);
    await chooseMenuItem(page, "Pin");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect(
      page.getByRole("list", { name: "Pinned" }).getByRole("button"),
    ).toHaveText(["Q4 plan", "Budget 2026", "Meeting notes"]);
    // Esc closes a menu and returns focus to the row.
    await openRowMenu(page);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
    await expect.poll(() => activeKey(page)).toBe("doc:d-meeting");
  });

  test("tree keys: → ← * Home End, Shift+↓ and ⌘A select, Esc clears", async ({
    page,
  }) => {
    await f6ToSidebar(page);
    await page.keyboard.press("*");
    for (const key of ["folder:f-personal", "folder:f-work"]) {
      await expect(row(page, key)).toHaveAttribute("aria-expanded", "true");
    }
    await typeTo(page, "work", "folder:f-work");
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, "folder:f-work")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(await activeKey(page)).toBe("folder:f-q4");
    await page.keyboard.press("ArrowLeft");
    expect(await activeKey(page)).toBe("folder:f-work");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(tree(page).locator('[aria-selected="true"]')).toHaveCount(3);
    await page.keyboard.press("Escape");
    await expect(tree(page).locator('[aria-selected="true"]')).toHaveCount(0);
    await page.keyboard.press("ControlOrMeta+a");
    await expect(tree(page).locator('[aria-selected="true"]')).toHaveCount(2);
    await page.keyboard.press("Home");
    expect(await activeKey(page)).toBe("folder:f-archive");
    await expect(row(page, "folder:f-archive")).toHaveAttribute(
      "aria-level",
      "1",
    );
    await expect(row(page, "folder:f-archive")).toHaveAttribute(
      "aria-posinset",
      "1",
    );
  });
});

test.describe("folder rules", () => {
  test("Move to… refuses a folder into its own descendant", async ({
    page,
  }) => {
    await f6ToSidebar(page);
    await typeTo(page, "work", "folder:f-work");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    expect(await activeKey(page)).toBe("folder:f-q4");
    await openRowMenu(page);
    await chooseMenuItem(page, "Move to…");
    const dialog = page.getByRole("dialog", { name: "Move “Q4”" });
    const dest = (name: string) =>
      dialog.getByRole("treeitem", { name: new RegExp(`^${name}`) });
    for (const name of ["Q4", "Drafts", "Old", "Work"]) {
      await expect(dest(name)).toHaveAttribute("aria-disabled", "true");
    }
    await expect(dest("Work")).toContainText("Current folder");
    for (const name of ["Library", "Archive", "Personal"]) {
      await expect(dest(name)).not.toHaveAttribute("aria-disabled", "true");
    }
    // Arrow onto its own subfolder: the reason shows and Enter does nothing.
    await page.keyboard.press("ArrowDown");
    await expect(dest("Library")).toBeFocused();
    // Library, Archive, Personal, Work, Q4, Drafts.
    for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
    await expect(dest("Drafts")).toBeFocused();
    await expect(
      dialog.getByText("A folder can't go inside itself."),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect.poll(() => activeKey(page)).toBe("folder:f-q4");
    expect(
      (await library(page)).folders.find((f) => f.id === "f-q4")?.parentId,
    ).toBe("f-work");
  });

  test("Work (4 levels deep) can only stay at the root", async ({ page }) => {
    await f6ToSidebar(page);
    await typeTo(page, "work", "folder:f-work");
    await openRowMenu(page);
    await chooseMenuItem(page, "Move to…");
    const dialog = page.getByRole("dialog", { name: "Move “Work”" });
    await expect(
      dialog.getByRole("textbox", { name: "Filter folders" }),
    ).toBeFocused();
    await expect(
      dialog.getByRole("treeitem", { name: /^Archive/ }),
    ).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expect(
      dialog.getByRole("treeitem", { name: /^Archive/ }),
    ).toBeFocused();
    await expect(
      dialog.getByText("Folders can be nested 4 levels deep."),
    ).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("a fifth folder level is refused", async ({ page }) => {
    await f6ToSidebar(page);
    await typeTo(page, "work", "folder:f-work");
    // Expand and step in, three times: Work › Q4 › Drafts › Old.
    for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
    expect(await activeKey(page)).toBe("folder:f-old");
    await openRowMenu(page);
    await chooseMenuItem(page, "New Folder");
    await expect(page.getByTestId("pill")).toContainText(
      "Folders can be nested 4 levels deep.",
    );
    expect((await library(page)).folders).toHaveLength(6);
  });
});

test.describe("pointer", () => {
  async function drag(page: Page, from: Locator, to: Locator) {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    if (!a || !b) throw new Error("no box");
    await page.mouse.move(a.x + 30, a.y + a.height / 2);
    await page.mouse.down();
    await page.mouse.move(a.x + 40, a.y + a.height / 2 + 6, { steps: 4 });
    await page.mouse.move(b.x + 40, b.y + b.height / 2, { steps: 12 });
    return {
      drop: async () => {
        await page.mouse.up();
      },
    };
  }

  test("dragging a document onto a folder moves it", async ({ page }) => {
    const handle = await drag(
      page,
      row(page, "doc:d-meeting"),
      row(page, "folder:f-archive"),
    );
    await expect(row(page, "folder:f-archive")).toHaveAttribute(
      "data-drop",
      "ok",
    );
    await handle.drop();
    expect(
      (await library(page)).items.find((d) => d.id === "d-meeting")?.folderId,
    ).toBe("f-archive");
    await expect(page.getByTestId("pill")).toContainText(
      "Moved “Meeting notes” to Archive.",
    );
  });

  test("a folder dropped into its own descendant is refused", async ({
    page,
  }) => {
    await row(page, "folder:f-work").locator(".lib-chevron").click();
    await row(page, "folder:f-q4").locator(".lib-chevron").click();
    const handle = await drag(
      page,
      row(page, "folder:f-work"),
      row(page, "folder:f-drafts"),
    );
    await expect(row(page, "folder:f-drafts")).toHaveAttribute(
      "data-drop",
      "refused",
    );
    await handle.drop();
    await expect(page.getByTestId("pill")).toContainText(
      "A folder can't go inside itself.",
    );
    expect(
      (await library(page)).folders.find((f) => f.id === "f-work")?.parentId,
    ).toBeNull();
  });

  test("hovering a closed folder opens it after 700 ms", async ({ page }) => {
    const handle = await drag(
      page,
      row(page, "doc:d-meeting"),
      row(page, "folder:f-personal"),
    );
    await expect(row(page, "folder:f-personal")).toHaveAttribute(
      "aria-expanded",
      "true",
      { timeout: 2000 },
    );
    await handle.drop();
  });

  test("dropping on Pinned pins, on Trash trashes", async ({ page }) => {
    const pinned = page
      .getByRole("navigation", { name: "Files" })
      .getByRole("button", { name: "Pinned", exact: true });
    const handle = await drag(page, row(page, "doc:d-meeting"), pinned);
    await handle.drop();
    await expect(
      page.getByRole("list", { name: "Pinned" }).getByRole("button"),
    ).toHaveText(["Q4 plan", "Budget 2026", "Meeting notes"]);

    const trash = page.getByRole("button", { name: /^Trash/ });
    const second = await drag(page, row(page, "doc:d-fa"), trash);
    await second.drop();
    await expect(row(page, "doc:d-fa")).toHaveCount(0);
    expect((await library(page)).trashCount).toBe(1);
  });
});

test.describe("right-to-left", () => {
  test("← goes into a folder and → back out", async ({ page }) => {
    await page.goto("/?dir=rtl");
    await f6ToSidebar(page);
    await typeTo(page, "work", "folder:f-work");
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, "folder:f-work")).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    await page.keyboard.press("ArrowLeft");
    expect(await activeKey(page)).toBe("folder:f-q4");
    await page.keyboard.press("ArrowRight");
    expect(await activeKey(page)).toBe("folder:f-work");
  });
});

test.describe("accessibility", () => {
  for (const theme of ["light", "dark"]) {
    test(`axe finds nothing in the sidebar, Quick Open and Move to… (${theme})`, async ({
      page,
    }) => {
      await page.goto(`/?theme=${theme}`);
      await f6ToSidebar(page);
      await page.keyboard.press("*");
      // Scans what has focus: the page, or the open dialog alone (the page
      // behind it is inert). Waits for enter animations to finish.
      const scan = async () => {
        await page.waitForFunction(() =>
          document.getAnimations().every((a) => a.playState !== "running"),
        );
        const dialog = await page.getByRole("dialog").count();
        const builder = new AxeBuilder({ page }).withTags([
          "wcag2a",
          "wcag2aa",
          "wcag21a",
          "wcag21aa",
        ]);
        return (
          dialog ? builder.include('[role="dialog"]') : builder
        ).analyze();
      };
      expect((await scan()).violations).toEqual([]);

      await openQuickOpen(page);
      await page.keyboard.type("q4");
      await expect(page.getByRole("option").first()).toBeVisible();
      expect((await scan()).violations).toEqual([]);
      await page.keyboard.press("Escape");

      await typeTo(page, "work", "folder:f-work");
      await openRowMenu(page);
      await chooseMenuItem(page, "Move to…");
      await expect(page.getByRole("dialog")).toBeVisible();
      expect((await scan()).violations).toEqual([]);
    });
  }
});
