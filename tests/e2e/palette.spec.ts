import { gzipSync } from "node:zlib";

import { expect, type Page, test } from "@playwright/test";

import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";

/**
 * PR E (v1.1): the Alt+/ palette, Repeat formatting, Your formats and the
 * Mermaid templates. Needs `next dev` (`window.__tiptap_editor`), except
 * the budget test, which runs against a production build only
 * (`PALETTE_BUDGET=1`).
 */

const PALETTE = "[data-command-palette]";
const PALETTE_BUDGET_BYTES = 15 * 1024;
const repeatKey = process.platform === "darwin" ? "Meta+Alt+KeyV" : "F4";

type EditorWindow = Window & {
  __tiptap_editor?: {
    state: {
      doc: {
        descendants(
          fn: (
            node: { isText: boolean; text?: string },
            pos: number,
          ) => boolean,
        ): void;
      };
      selection: { from: number; to: number };
    };
    commands: {
      setTextSelection(range: { from: number; to: number }): boolean;
    };
    getHTML(): string;
  };
};

async function openDoc(page: Page): Promise<EditorPage> {
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();
  await typeInNewParagraphAtEnd(page, "alpha beta gamma delta");
  return editor;
}

/** Selects the first occurrence of `text` through the editor. */
async function select(page: Page, text: string): Promise<void> {
  await page.evaluate((needle) => {
    const editor = (window as EditorWindow).__tiptap_editor;
    if (!editor) throw new Error("no editor");
    let range: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (range || !node.isText) return !range;
      const index = node.text?.indexOf(needle) ?? -1;
      if (index >= 0)
        range = { from: pos + index, to: pos + index + needle.length };
      return false;
    });
    if (!range) throw new Error(`text not found: ${needle}`);
    editor.commands.setTextSelection(range);
  }, text);
}

const html = (page: Page) =>
  page.evaluate(
    () => (window as EditorWindow).__tiptap_editor?.getHTML() ?? "",
  );

const selection = (page: Page) =>
  page.evaluate(() => {
    const s = (window as EditorWindow).__tiptap_editor?.state.selection;
    return s ? { from: s.from, to: s.to } : null;
  });

async function runFromPalette(page: Page, query: string): Promise<void> {
  await page.keyboard.press("Alt+Slash");
  await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
  await page.keyboard.type(query);
  await page.keyboard.press("Enter");
  await expect(page.locator(PALETTE)).toHaveCount(0);
}

test.describe("action palette", () => {
  test.skip(process.env.PALETTE_BUDGET === "1", "budget run only");

  test("loads lazily and opens on Alt+/ and Alt+Shift+Z; Esc restores focus and selection", async ({
    page,
  }) => {
    await openDoc(page);
    await expect(page.locator(PALETTE)).toHaveCount(0);
    const scripts: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "script") scripts.push(request.url());
    });
    await select(page, "beta");
    const before = await selection(page);

    await page.keyboard.press("Alt+Slash");
    await expect(page.locator(PALETTE)).toBeVisible();
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    expect(scripts.length).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
    await expect(page.locator(PALETTE)).toHaveCount(0);
    await expect(page.locator(".tiptap")).toBeFocused();
    expect(await selection(page)).toEqual(before);

    await page.keyboard.press("Alt+Shift+KeyZ");
    await expect(page.locator(PALETTE)).toBeVisible();
    // Alt+/ inside the palette's own search closes it.
    await page.keyboard.press("Alt+Slash");
    await expect(page.locator(PALETTE)).toHaveCount(0);
    expect(await selection(page)).toEqual(before);
  });

  test("leaves Alt+/ to other text fields", async ({ page }) => {
    await openDoc(page);
    await page.evaluate(() => {
      const input = document.createElement("input");
      input.id = "outside-field";
      document.body.append(input);
    });
    await page.locator("#outside-field").focus();
    await page.keyboard.press("Alt+Slash");
    await expect(page.locator(PALETTE)).toHaveCount(0);
  });

  test("Repeat formatting sets, is one undo step, and runs from the key and the palette", async ({
    page,
  }) => {
    await openDoc(page);
    await select(page, "alpha");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.press("ControlOrMeta+i");

    await select(page, "beta");
    await page.keyboard.press(repeatKey);
    await expect
      .poll(() => html(page))
      .toContain("<strong><em>beta</em></strong>");

    // Sets, never toggles.
    await select(page, "beta");
    await page.keyboard.press(repeatKey);
    await expect
      .poll(() => html(page))
      .toContain("<strong><em>beta</em></strong>");

    // One undo step: one undo reverts beta, alpha keeps its formatting.
    await select(page, "gamma");
    await page.keyboard.press(repeatKey);
    await expect
      .poll(() => html(page))
      .toContain("<strong><em>gamma</em></strong>");
    await page.keyboard.press("ControlOrMeta+z");
    await expect.poll(() => html(page)).not.toContain("<em>gamma</em>");
    expect(await html(page)).toContain("<strong><em>alpha</em></strong>");

    // From the palette, where it is suggested with its face.
    await select(page, "delta");
    await page.keyboard.press("Alt+Slash");
    await expect(
      page.getByRole("option", { name: /Repeat formatting: B · I/ }).first(),
    ).toBeVisible();
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    await page.keyboard.type("repeat formatting");
    await page.keyboard.press("Enter");
    await expect
      .poll(() => html(page))
      .toContain("<strong><em>delta</em></strong>");

    // Recent remembers the palette pick.
    await page.keyboard.press("Alt+Slash");
    const firstGroup = page.locator(`${PALETTE} [cmdk-group-heading]`).first();
    await expect(firstGroup).toHaveText("Recent");
    await page.keyboard.press("Escape");
  });

  test("Copy formatting then Repeat clears formatting it lacks", async ({
    page,
  }) => {
    await openDoc(page);
    await select(page, "alpha");
    await page.keyboard.press("ControlOrMeta+b");
    await select(page, "gamma");
    await runFromPalette(page, "copy formatting");
    await select(page, "alpha");
    await page.keyboard.press(repeatKey);
    await expect.poll(() => html(page)).not.toContain("<strong>alpha</strong>");
  });

  test("lists unavailable actions with their reason and keeps the palette open", async ({
    page,
  }) => {
    await openDoc(page);
    await page.locator(".tiptap").click();
    await page.keyboard.press("Alt+Slash");
    const repeat = page.getByRole("option", { name: /^Repeat formatting/ });
    await expect(repeat).toHaveAccessibleDescription(
      "Format some text first, or use Copy formatting.",
    );
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    await page.keyboard.type("repeat formatting");
    await page.keyboard.press("Enter");
    await expect(page.locator(PALETTE)).toBeVisible();
    await page.keyboard.press("Escape");
  });

  test("saves and applies a format, kept across reloads", async ({ page }) => {
    await openDoc(page);
    await select(page, "alpha");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.press("ControlOrMeta+u");
    await page.keyboard.press("Alt+Slash");
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    await page.keyboard.type("save as format");
    await page.keyboard.press("Enter");
    const name = page.getByLabel("Name");
    await expect(name).toHaveValue("B · U");
    await name.fill("Callout");
    await page.keyboard.press("Enter");
    await expect(page.locator(PALETTE)).toHaveCount(0);

    await select(page, "gamma");
    await runFromPalette(page, "apply format callout");
    await expect
      .poll(() => html(page))
      .toContain("<strong><u>gamma</u></strong>");

    await page.reload();
    await page.waitForSelector(".tiptap");
    await page.keyboard.press("Alt+Slash");
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    await page.keyboard.type("callout");
    await expect(
      page.getByRole("option", { name: /Apply format: Callout/ }),
    ).toBeVisible();
  });

  test("inserts a diagram from a template", async ({ page }) => {
    await openDoc(page);
    await page.locator(".tiptap").click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await runFromPalette(page, "insert diagram pie");
    await expect(page.locator(".tiptap svg").first()).toBeVisible({
      timeout: 10_000,
    });
    expect(await html(page)).toContain("pie title Share of time");
  });
});

test.describe("palette budget", () => {
  test.skip(process.env.PALETTE_BUDGET !== "1", "production build only");

  test("the palette chunk plus cmdk loads on the first Alt+/ within 15 KB gz", async ({
    page,
  }) => {
    const editor = new EditorPage(page);
    await editor.goto();
    await page.waitForLoadState("networkidle");
    await page.locator(".tiptap").first().click();
    const sizes: { url: string; gz: number }[] = [];
    const pending: Promise<void>[] = [];
    page.on("response", (response) => {
      if (!response.url().endsWith(".js")) return;
      pending.push(
        response.body().then((body) => {
          sizes.push({ url: response.url(), gz: gzipSync(body).length });
        }),
      );
    });
    await page.keyboard.press("Alt+Slash");
    await expect(page.locator(PALETTE)).toBeVisible();
    await page.waitForLoadState("networkidle");
    await Promise.all(pending);
    const total = sizes.reduce((sum, entry) => sum + entry.gz, 0);
    console.log(
      "palette chunks (gzip bytes):",
      JSON.stringify(sizes),
      "total",
      total,
    );
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(PALETTE_BUDGET_BYTES);
  });
});
