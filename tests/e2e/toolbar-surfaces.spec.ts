/**
 * PR D2 surfaces: colour popover + split faces (M1–M3), size stepper, the
 * phone colour panel, outline memory (M6) and the memory kill switch.
 * Desktop row placement is PR D1's; until it lands, the phone panel is the
 * one place these controls render, so most cases run at phone width.
 */
import { expect, type Page, test } from "@playwright/test";

import {
  expectNoSeriousA11yViolations,
  openToolbarTestDoc,
  setTheme,
} from "./helpers/a11y";

const PHONE = { width: 390, height: 844 };
const SCREENS = ".superpowers/screens-D2";

async function selectNewParagraph(page: Page, text = "colour me") {
  await page.evaluate((value) => {
    const editor = window.__tiptap_editor;
    if (!editor) throw new Error("editor missing");
    const end = editor.state.doc.content.size;
    editor
      .chain()
      .focus()
      .insertContentAt(end, {
        type: "paragraph",
        content: [{ type: "text", text: value }],
      })
      .run();
    const to = editor.state.doc.content.size - 1;
    editor
      .chain()
      .focus()
      .setTextSelection({ from: to - value.length, to })
      .run();
  }, text);
}

/** Highlight token on the last paragraph's text, or null. */
const lastHighlight = (page: Page) =>
  page.evaluate(() => {
    const doc = window.__tiptap_editor?.state.doc;
    const mark = doc?.lastChild?.firstChild?.marks.find(
      (m) => m.type.name === "highlight",
    );
    return (mark?.attrs.color as string | undefined) ?? null;
  });

async function openPhonePanel(page: Page) {
  await page.setViewportSize(PHONE);
  await openToolbarTestDoc(page);
  await selectNewParagraph(page);
  await page
    .getByRole("toolbar")
    .getByRole("button", { name: "Highlight text" })
    .click();
}

const toolbar = (page: Page) => page.getByRole("toolbar");

test("phone panel reaches text colour, highlight and size", async ({
  page,
}) => {
  await openPhonePanel(page);
  await expect(
    toolbar(page).getByRole("button", { name: /^Apply text colour: / }),
  ).toBeVisible();
  await expect(
    toolbar(page).getByRole("button", { name: /^Apply highlight: / }),
  ).toBeVisible();
  await expect(
    toolbar(page).getByRole("spinbutton", { name: "Font size" }),
  ).toBeVisible();
});

test("highlight popover applies a token, remembers it and lists it as recent", async ({
  page,
}) => {
  await openPhonePanel(page);
  await toolbar(page)
    .getByRole("button", { name: "More highlight colours" })
    .click();
  const dialog = page.getByRole("dialog", { name: "Highlight colours" });
  // Named aria-pressed buttons, no radiogroup (spec §4.5, a11y #3).
  await expect(dialog.getByRole("radiogroup")).toHaveCount(0);
  const blue = dialog.getByRole("button", { name: "Blue highlight" });
  await expect(blue).toHaveAttribute("aria-pressed", "false");
  // Arrow keys move focus only: nothing is applied.
  await expect(
    dialog.getByRole("button", { name: "No highlight" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect(await lastHighlight(page)).toBeNull();
  await blue.click();
  await expect(dialog).toBeHidden();
  expect(await lastHighlight(page)).toBe("blue");

  // M2: the face now names and reapplies blue.
  const face = toolbar(page).getByRole("button", {
    name: "Apply highlight: Blue",
  });
  await expect(face).toBeVisible();
  await page.evaluate(() => window.__tiptap_editor?.commands.unsetHighlight());
  expect(await lastHighlight(page)).toBeNull();
  await face.click();
  expect(await lastHighlight(page)).toBe("blue");

  // M3: Recent shows it on the next open; the memory survives a reload.
  await toolbar(page)
    .getByRole("button", { name: "More highlight colours" })
    .click();
  const recent = dialog.getByRole("group", { name: "Recent" });
  await expect(
    recent.getByRole("button", { name: "Blue highlight" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("group", { name: "Highlight" }).getByRole("button", {
      name: "Blue highlight",
    }),
  ).toHaveAttribute("aria-pressed", "true");
  await expectNoSeriousA11yViolations(page, [
    '[role="dialog"][aria-label="Highlight colours"]',
  ]);
  await page.keyboard.press("Escape");

  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tinydocy-choices") ?? "null"),
  );
  expect(stored).toMatchObject({
    v: 1,
    slots: {
      highlight: { last: "blue" },
      recentColors: { recent: [{ kind: "highlight", token: "blue" }] },
    },
  });
});

test("size stepper is a named spinbutton, disabled with a reason in headings", async ({
  page,
}) => {
  await openPhonePanel(page);
  const spin = toolbar(page).getByRole("spinbutton", { name: "Font size" });
  await expect(spin).toHaveAttribute("aria-valuetext", /pixels|Mixed/);
  await page.evaluate(() =>
    window.__tiptap_editor?.chain().focus().setTextSelection(1).run(),
  );
  await expect(spin).toHaveAttribute("aria-disabled", "true");
  const reasonId = await spin.getAttribute("aria-describedby");
  expect(reasonId).toBeTruthy();
  await expect(page.locator(`[id="${reasonId}"]`)).toHaveText(
    "Headings scale automatically.",
  );
});

test("tampered memory falls back to defaults without errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem(
      "tinydocy-choices",
      JSON.stringify({
        v: 1,
        slots: {
          highlight: { last: "url(javascript:alert(1))" },
          recentColors: { recent: [{ kind: "highlight", token: "<img>" }, 7] },
          __proto__: { polluted: true },
        },
      }),
    );
  });
  await openPhonePanel(page);
  await expect(
    toolbar(page).getByRole("button", { name: "Apply highlight: Yellow" }),
  ).toBeVisible();
  await toolbar(page)
    .getByRole("button", { name: "More highlight colours" })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("group", { name: "Recent" }),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("outline open state survives a reload (M6) and Forget keeps it", async ({
  page,
}) => {
  await openToolbarTestDoc(page);
  const outline = page.locator(".toc-sidebar");
  await expect(outline).toBeVisible();
  await page.getByRole("button", { name: "Toggle outline" }).click();
  await expect(outline).toBeHidden();
  await page.evaluate(() => localStorage.removeItem("tinydocy-choices"));
  await page.reload();
  await page.locator('[data-server-synced="true"]').waitFor();
  await expect(outline).toBeHidden();
  await page.getByRole("button", { name: "Toggle outline" }).click();
  await expect(outline).toBeVisible();
});

for (const theme of ["light", "dark"] as const) {
  test(`screenshots of the colour popover and phone panel (${theme})`, async ({
    page,
  }) => {
    await setTheme(page, theme);
    await openPhonePanel(page);
    // Text colour stays disabled until PR C registers its mark.
    await toolbar(page)
      .getByRole("button", { name: "More highlight colours" })
      .click();
    const dialog = page.getByRole("dialog", { name: "Highlight colours" });
    await expect(
      dialog.getByRole("button", { name: "Red text" }),
    ).toBeVisible();
    await page.mouse.move(0, PHONE.height - 1);
    await dialog.evaluate((el) =>
      Promise.all(
        el
          .getAnimations({ subtree: true })
          .map((animation) => animation.finished),
      ),
    );
    await page.screenshot({
      path: `${SCREENS}/phone-colour-popover-${theme}.png`,
    });
    // The floating popover must not clip the 2px focus outline.
    const focused = dialog.locator("button:focus-visible");
    if ((await focused.count()) > 0) {
      const clipped = await focused.evaluate((el) => {
        const popup = el.closest('[role="dialog"]') as HTMLElement;
        const a = el.getBoundingClientRect();
        const b = popup.getBoundingClientRect();
        return a.left - 4 < b.left || a.right + 4 > b.right;
      });
      expect(clipped).toBe(false);
    }
    await page.keyboard.press("Escape");
    await toolbar(page).screenshot({
      path: `${SCREENS}/phone-panel-${theme}.png`,
    });
  });
}
