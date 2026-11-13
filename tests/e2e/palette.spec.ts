import { gzipSync } from "node:zlib";

import { expect, type Page, test } from "@playwright/test";

import {
  contrastRatio,
  expectNoSeriousA11yViolations,
  resolveRgb,
  setTheme,
} from "./helpers/a11y";
import { EditorPage, typeInNewParagraphAtEnd } from "./helpers/editor-page";
import { CHUNK_MARKERS, interceptChunk } from "./helpers/lazy-chunk";

/**
 * PR E (v1.1): the Alt+/ palette, Repeat formatting, Your formats and the
 * Mermaid templates. Needs `next dev` (`window.__tiptap_editor`), except
 * the budget test, which runs against a production build only
 * (`PALETTE_BUDGET=1`).
 */

const PALETTE = "[data-command-palette]";
/**
 * Contract A7 (owner decision O5, 2026-11-13): palette chunk plus cmdk
 * ≤ 20 KB gz (spec: 15). Measured 19,981 B on the r2 rebuild.
 */
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

/** Opens the palette's Save view from the list, once the search has focus. */
async function openSaveView(page: Page): Promise<void> {
  await page.keyboard.press("Alt+Slash");
  await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
  await page.keyboard.type("save as format");
  await page
    .locator(`${PALETTE} [cmdk-item][data-action-id="formats.save"]`)
    .first()
    .click();
  await expect(page.getByLabel("Name")).toBeFocused();
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
    // Every option is an option with its own selected state.
    expect(
      await page
        .locator(`${PALETTE} [cmdk-item]`)
        .evaluateAll(
          (items) =>
            items.filter(
              (item) =>
                item.getAttribute("role") !== "option" ||
                !["true", "false"].includes(
                  item.getAttribute("aria-selected") ?? "",
                ),
            ).length,
        ),
    ).toBe(0);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await expectInSync();
    // Arrowing moves the active descendant, never focus.
    await expect(input).toBeFocused();
    for (const char of "bol") {
      await page.keyboard.type(char);
      await expectInSync();
    }
    await page.keyboard.press("ArrowDown");
    await expectInSync();
    await expect(input).toBeFocused();
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

  test("shortcut glyphs are hidden; the option names its keys", async ({
    page,
  }) => {
    await openDoc(page);
    await page.keyboard.press("Alt+Slash");
    await page.keyboard.type("bold");
    const bold = page.locator(
      `${PALETTE} [cmdk-item][data-action-id="mark.bold"]`,
    );
    await expect(bold).toHaveAttribute(
      "aria-keyshortcuts",
      /^(Meta|Control)\+b$/i,
    );
    await expect(
      bold.locator('[data-slot="command-shortcut"]'),
    ).toHaveAttribute("aria-hidden", "true");
    await expect(bold).toHaveAccessibleName(/^Bold/);
    await expect(bold).not.toHaveAccessibleName(/⌘|Ctrl/);
    await page.keyboard.press("Escape");
  });

  test("typing highlights the best match and a status region announces the results (WCAG 4.1.3)", async ({
    page,
  }) => {
    await openDoc(page);
    // cmdk highlights on pointer move: keep the pointer off the list.
    await page.mouse.move(0, 0);
    await page.keyboard.press("Alt+Slash");
    const input = page.getByPlaceholder("Search actions…");
    await expect(input).toBeFocused();
    const status = page.locator(`${PALETTE} [role="status"]`);
    await expect(status).toHaveCount(1);
    await expect(status).toHaveText("");

    await page.keyboard.type("bol");
    const active = page.locator(`${PALETTE} [cmdk-item][data-selected="true"]`);
    await expect(active).toHaveAttribute("data-action-id", "mark.bold");
    await expect(active).toHaveText(/^Bold/);
    await expect(status).toHaveText(/^\d+ actions?$/);

    await page.keyboard.type("zzzzqqq");
    await expect(status).toHaveText("No matching actions");
    for (let i = 0; i < 7; i += 1) await page.keyboard.press("Backspace");
    await expect(status).toHaveText(/^\d+ actions?$/);

    // Enter runs the highlighted option: Bold, not the second row.
    await page.keyboard.press("Escape");
    await select(page, "gamma");
    await runFromPalette(page, "bol");
    expect(await html(page)).toContain("<strong>gamma</strong>");
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

    // From the palette, where it is suggested, with what it applies as
    // its second line.
    await select(page, "delta");
    await page.keyboard.press("Alt+Slash");
    await expect(
      page
        .getByRole("group", { name: "Suggested here" })
        .getByRole("option", { name: /^Repeat formatting/ }),
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

  /** Holds the engine chunk until the returned `release` is called. */
  async function holdEngine(page: Page) {
    let release = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const unroute = await interceptChunk(
      page,
      CHUNK_MARKERS.engine,
      async (route, response) => {
        await held;
        await route.fulfill({ response });
      },
    );
    return { release, unroute };
  }

  for (const moved of [false, true]) {
    test(`Repeat pressed before the engine lands ${moved ? "is dropped if the selection moves" : "runs once it arrives"}`, async ({
      page,
    }) => {
      const { release, unroute } = await holdEngine(page);
      await openDoc(page);
      await select(page, "alpha");
      await page.keyboard.press("ControlOrMeta+b");
      await page.keyboard.press("ControlOrMeta+i");
      await select(page, "beta");
      await page.keyboard.press(repeatKey);
      // Still loading: nothing applied yet.
      expect(await html(page)).not.toContain("<em>beta</em>");
      if (moved) await select(page, "gamma");

      release();
      if (moved) {
        // Once loaded, the key works on the new selection.
        await page.keyboard.press(repeatKey);
        await expect
          .poll(() => html(page))
          .toContain("<strong><em>gamma</em></strong>");
        expect(await html(page)).not.toContain("<em>beta</em>");
      } else {
        await expect
          .poll(() => html(page))
          .toContain("<strong><em>beta</em></strong>");
      }
      await unroute();
    });
  }

  test("Paint format then Repeat clears formatting it lacks", async ({
    page,
  }) => {
    await openDoc(page);
    await select(page, "alpha");
    await page.keyboard.press("ControlOrMeta+b");
    await select(page, "gamma");
    await page.keyboard.press("ControlOrMeta+i");
    // Its keyword "brush": cmdk's fuzzy match also finds "paint format"
    // in Repeat's "Repeat formatting: Italic", which leads the list from
    // Suggested here.
    await runFromPalette(page, "brush");
    await select(page, "alpha");
    await page.keyboard.press(repeatKey);
    // Italic, and no bold: the picked-up read clears what gamma lacks.
    await expect.poll(() => html(page)).toContain("<em>alpha</em>");
    await expect.poll(() => html(page)).not.toContain("<strong>");
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
      /^Repeat formatting ?, unavailable Nothing to repeat yet\. Format some text or use Paint format\./,
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
    await expect(name).toHaveAttribute("placeholder", "e.g. Warning");
    await expect(
      page.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    await name.fill("Callout");
    await page.keyboard.press("Enter");
    await expect(page.locator(PALETTE)).toHaveCount(0);

    await select(page, "gamma");
    await page.keyboard.press("Alt+Slash");
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    await page.keyboard.type("callout");
    await page
      .getByRole("group", { name: "Your formats" })
      .getByRole("option", { name: /^Callout/ })
      .click();
    await expect(page.locator(PALETTE)).toHaveCount(0);
    await expect
      .poll(() => html(page))
      .toContain("<strong><u>gamma</u></strong>");

    await page.reload();
    await page.waitForSelector(".tiptap");
    await page.keyboard.press("Alt+Slash");
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    await page.keyboard.type("callout");
    // D2's memory layer keeps Recent across the reload too, so look in
    // Your formats, where saved formats always appear, by name.
    await expect(
      page
        .getByRole("group", { name: "Your formats" })
        .getByRole("option", { name: /^Callout/ }),
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

test.describe("palette design pass (§7, §8)", () => {
  test.skip(process.env.PALETTE_BUDGET === "1", "budget run only");

  test("the Save dialog previews the format and keeps Save disabled until named", async ({
    page,
  }) => {
    await openDoc(page);
    await select(page, "alpha");
    await page.keyboard.press("ControlOrMeta+b");
    await page.keyboard.press("ControlOrMeta+i");
    await openSaveView(page);
    const dialog = page.locator(PALETTE);
    await expect(
      dialog.getByText("Reuse this style anywhere. Saved on this device."),
    ).toBeVisible();
    const preview = dialog.locator("[data-format-preview]");
    await expect(preview).toContainText("Sample text");
    await expect(preview).toContainText("Bold, Italic");
    const sample = await preview.getByText("Sample text").evaluate((el) => ({
      weight: getComputedStyle(el).fontWeight,
      style: getComputedStyle(el).fontStyle,
    }));
    expect(sample).toEqual({ weight: "700", style: "italic" });
    const name = page.getByLabel("Name");
    await expect(name).toBeFocused();
    await expect(name).toHaveAttribute("placeholder", "e.g. Warning");
    await expect(dialog.getByText("Up to 40 characters")).toBeVisible();
    const save = dialog.getByRole("button", { name: "Save", exact: true });
    await expect(save).toBeDisabled();
    await name.fill("  ");
    await expect(save).toBeDisabled();
    await name.fill("Warning");
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator(".tiptap")).toBeFocused();
    expect(await selection(page)).not.toBeNull();

    // Saving over the name says so first.
    await select(page, "beta");
    await page.keyboard.press("ControlOrMeta+u");
    await openSaveView(page);
    await name.fill("warning");
    await expect(
      dialog.getByText("Replaces your format ‘Warning’."),
    ).toBeVisible();
    await expect(name).toHaveAccessibleDescription(
      "Up to 40 characters Replaces your format ‘Warning’.",
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  test("at 20 formats the Save dialog asks to remove one, with a link", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const formats = Array.from({ length: 20 }, (_, i) => ({
        id: `f${i}`,
        name: `Format ${i}`,
        bundle: { bold: true },
      }));
      localStorage.setItem(
        "tinydocy-formats",
        JSON.stringify({ v: 1, formats }),
      );
    });
    await openDoc(page);
    await select(page, "alpha");
    await page.keyboard.press("ControlOrMeta+b");
    await openSaveView(page);
    const dialog = page.locator(PALETTE);
    await page.getByLabel("Name").fill("Another");
    await expect(
      dialog.getByText("You can keep up to 20 formats. Remove one first."),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Remove a format" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Save", exact: true }),
    ).toBeDisabled();
    // An existing name replaces, so the cap does not apply.
    await page.getByLabel("Name").fill("Format 3");
    await expect(
      dialog.getByText("Replaces your format ‘Format 3’."),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Save", exact: true }),
    ).toBeEnabled();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
  });

  test("rows: leading icons and chips, bare colour names, reasons on a second line, Suggested once", async ({
    page,
  }) => {
    await openDoc(page);
    // A remembered bundle and a selection: Repeat is suggested here.
    await select(page, "alpha");
    await page.keyboard.press("ControlOrMeta+b");
    await select(page, "beta");
    await page.keyboard.press("Alt+Slash");
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    const palette = page.locator(PALETTE);
    const suggested = palette.getByRole("group", { name: "Suggested here" });
    await expect(suggested).toBeVisible();
    const suggestedIds = await suggested
      .getByRole("option")
      .evaluateAll((els) => els.map((el) => el.getAttribute("data-action-id")));
    expect(suggestedIds).toContain("repeat.apply");
    expect(suggestedIds.length).toBeLessThanOrEqual(4);
    for (const id of suggestedIds) {
      // Shown once: Suggested here (and Recent, if picked before) only.
      await expect(
        palette.locator(
          `[cmdk-group]:not(:has([cmdk-group-heading]:text-is("Suggested here"))):not(:has([cmdk-group-heading]:text-is("Recent"))) [data-action-id="${id}"]`,
        ),
      ).toHaveCount(0);
    }

    // Colour rows: "Orange text", with a chip in the leading slot.
    await page.keyboard.type("orange text");
    const orange = palette.getByRole("option", { name: /^Orange text/ });
    await expect(orange).toBeVisible();
    await expect(
      palette.getByRole("option", { name: /^Text colour: Orange/ }),
    ).toHaveCount(0);
    await expect(orange.locator('.st-chip[data-token="orange"]')).toBeVisible();

    // An unavailable row: label at full contrast, reason muted, 48px tall.
    await page.keyboard.press("Escape");
    await expect(palette).toHaveCount(0);
    // A caret: Repeat needs a selection.
    await page.evaluate(() => {
      const editor = (window as EditorWindow).__tiptap_editor;
      const end = editor?.state.selection.to ?? 1;
      editor?.commands.setTextSelection({ from: end, to: end });
    });
    await page.keyboard.press("Alt+Slash");
    await expect(page.getByPlaceholder("Search actions…")).toBeFocused();
    await page.keyboard.type("repeat formatting");
    const repeat = palette.locator(
      '[cmdk-item][data-action-id="repeat.apply"]',
    );
    await expect(repeat).toHaveAttribute("data-unavailable", "");
    // Layout height (the dialog's zoom-in would scale a bounding box).
    const height = (el: HTMLElement) => el.offsetHeight;
    expect(await repeat.evaluate(height)).toBe(48);
    const colours = await repeat.evaluate((el) => {
      const label = el.querySelector(".truncate") as HTMLElement;
      const reason = label.nextElementSibling as HTMLElement;
      const style = getComputedStyle(el);
      return {
        label: getComputedStyle(label).color,
        reason: getComputedStyle(reason).color,
        item: style.color,
        bg: style.backgroundColor,
        selected: el.getAttribute("data-selected"),
      };
    });
    expect(colours.label).toBe(colours.item);
    expect(colours.reason).not.toBe(colours.label);
    if (colours.selected === "true") {
      expect(
        contrastRatio(
          await resolveRgb(page, colours.reason),
          await resolveRgb(page, colours.bg),
        ),
      ).toBeGreaterThanOrEqual(4.5);
    }
    // No shortcut glyph on an unavailable row.
    await expect(repeat.locator('[data-slot="command-shortcut"]')).toHaveCount(
      0,
    );
    // A runnable single-line row is 32px, with its icon in the slot.
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type("bold");
    const bold = palette.locator('[cmdk-item][data-action-id="mark.bold"]');
    await expect(bold.locator("svg").first()).toBeVisible();
    expect(await bold.evaluate(height)).toBe(32);
    await page.keyboard.press("Escape");
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
      await expect(page.locator("[data-format-preview]")).toBeVisible();
      await expectNoSeriousA11yViolations(page, [PALETTE]);
      await page.keyboard.type("Callout");
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
    // The popup keeps a visible edge: forced colours drop the ring's
    // box-shadow and paint the backdrop and popup as Canvas (spec §4.5).
    const edge = await page.locator(PALETTE).evaluate((el) => {
      const style = getComputedStyle(el);
      return { style: style.borderTopStyle, width: style.borderTopWidth };
    });
    expect(edge.style).not.toBe("none");
    expect(edge.width).not.toBe("0px");
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
