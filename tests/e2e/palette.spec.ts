import { gzipSync } from "node:zlib";

import { expect, type Page, test } from "@playwright/test";

import {
  contrastRatio,
  expectNoSeriousA11yViolations,
  resolveRgb,
  setTheme,
} from "./helpers/a11y";
import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";

/**
 * PR E (v1.1): the Alt+/ palette, Repeat formatting, Your formats and the
 * Mermaid templates. Needs `next dev` (`window.__tiptap_editor`), except
 * the budget test, which runs against a production build only
 * (`PALETTE_BUDGET=1`).
 */

const PALETTE = "[data-command-palette]";
/** Owner decision (2026-11-13): palette chunk plus cmdk ≤ 20 KB gz (spec: 15). */
const PALETTE_BUDGET_BYTES = 20 * 1024;
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

  test("aria-activedescendant follows the highlighted option while filtering (WCAG 4.1.2)", async ({
    page,
  }) => {
    await openDoc(page);
    await page.keyboard.press("Alt+Slash");
    const input = page.getByPlaceholder("Search actions…");
    await expect(input).toBeFocused();

    /** The input's active descendant must be the one rendered option cmdk highlights. */
    const expectInSync = async () =>
      expect
        .poll(() =>
          input.evaluate((el) => {
            const id = el.getAttribute("aria-activedescendant");
            const target = id ? document.getElementById(id) : null;
            const highlighted = el
              .closest("[cmdk-root]")
              ?.querySelectorAll('[cmdk-item][aria-selected="true"]');
            return {
              resolves: !!target && target.getAttribute("role") === "option",
              selected: target?.getAttribute("aria-selected") ?? null,
              single: highlighted?.length === 1,
              same: !!target && highlighted?.[0] === target,
            };
          }),
        )
        .toEqual({
          resolves: true,
          selected: "true",
          single: true,
          same: true,
        });

    await expectInSync();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expectInSync();
    for (const char of "bol") {
      await page.keyboard.type(char);
      await expectInSync();
    }
    await page.keyboard.press("ArrowDown");
    await expectInSync();
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await expectInSync();

    // No results: nothing to point at.
    await page.keyboard.type("zzzzqqq");
    await expect(input).not.toHaveAttribute("aria-activedescendant", /.+/);
    for (let i = 0; i < 7; i += 1) await page.keyboard.press("Backspace");
    await expectInSync();
    await page.keyboard.press("Escape");
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
    // cmdk keeps items navigable with aria-disabled="false", so the state
    // is in the name, and the reason is read once.
    await expect(repeat).toHaveAccessibleName(
      /^Repeat formatting ?, unavailable Format some text first, or use Copy formatting\./,
    );
    await expect(repeat).not.toHaveAttribute("aria-describedby", /.+/);
    // The default highlight is one Enter can run.
    await expect(
      page.locator(`${PALETTE} [cmdk-item][data-selected="true"]`),
    ).not.toHaveAttribute("data-unavailable", /.*/);
    await expect(
      page.getByRole("option", { name: /^Save as format… ?, unavailable/ }),
    ).toBeVisible();
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
    await expect(
      page.getByRole("heading", { name: "Save as format" }),
    ).toBeVisible();
    const name = page.getByLabel("Name");
    await expect(name).toHaveValue("");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("alert")).toHaveText("Use 1–40 characters.");
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
    // D2's memory layer keeps Recent across the reload too, so look in the
    // Format group, where saved formats always appear.
    await expect(
      page
        .getByRole("group", { name: "Format" })
        .getByRole("option", { name: /Apply format: Callout/ }),
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

test.describe("palette accessibility", () => {
  test.skip(process.env.PALETTE_BUDGET === "1", "budget run only");

  for (const theme of ["light", "dark"] as const) {
    test(`open palette and save view have no serious axe violations (${theme})`, async ({
      page,
    }) => {
      await setTheme(page, theme);
      await openDoc(page);
      await select(page, "alpha");
      await page.keyboard.press("ControlOrMeta+b");
      await page.keyboard.press("Alt+Slash");
      const input = page.getByRole("combobox", { name: "Search actions" });
      await expect(input).toBeFocused();
      await expect(
        page.getByRole("listbox", { name: "Actions" }),
      ).toBeVisible();

      // The active option carries a 3:1 non-colour marker.
      const active = page.locator(
        `${PALETTE} [cmdk-item][data-selected="true"]`,
      );
      const marker = await active.evaluate((el) => {
        const bar = getComputedStyle(el, "::before");
        const popup = el.closest("[data-slot='command']") as HTMLElement;
        return {
          content: bar.content,
          width: bar.width,
          bar: bar.backgroundColor,
          bg: getComputedStyle(popup).backgroundColor,
        };
      });
      expect(marker.content).not.toBe("none");
      expect(Number.parseFloat(marker.width)).toBeGreaterThanOrEqual(2);
      expect(
        contrastRatio(
          await resolveRgb(page, marker.bar),
          await resolveRgb(page, marker.bg),
        ),
      ).toBeGreaterThanOrEqual(3);

      await expectNoSeriousA11yViolations(page, [PALETTE]);

      await page.keyboard.type("save as format");
      await page.keyboard.press("Enter");
      await expect(page.getByLabel("Name")).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("alert")).toBeVisible();
      await expectNoSeriousA11yViolations(page, [PALETTE]);
      await page.keyboard.press("Escape");
    });
  }

  test("forced colours paint the active option with Highlight", async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ forcedColors: "active" });
    await openDoc(page);
    await page.keyboard.press("Alt+Slash");
    const active = page.locator(`${PALETTE} [cmdk-item][data-selected="true"]`);
    await expect(active).toBeVisible();
    const bg = await active.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    const highlight = await page.evaluate(() => {
      const probe = document.createElement("div");
      probe.style.background = "Highlight";
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return color;
    });
    expect(await resolveRgb(page, bg)).toEqual(
      await resolveRgb(page, highlight),
    );
    // No outline painted on every option: an inactive one has none.
    const inactive = page
      .locator(`${PALETTE} [cmdk-item]:not([data-selected="true"])`)
      .first();
    expect(
      await inactive.evaluate((el) => getComputedStyle(el).outlineStyle),
    ).toBe("none");
    await testInfo.attach("palette-forced-colors", {
      body: await page.locator(PALETTE).screenshot(),
      contentType: "image/png",
    });
  });
});

test.describe("palette budget", () => {
  test.skip(process.env.PALETTE_BUDGET !== "1", "production build only");

  test("the palette chunk plus cmdk loads on the first Alt+/ within 20 KB gz", async ({
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
