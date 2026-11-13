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
/** A small touch phone: coarse pointer, 360px wide. */
const TOUCH_PHONE = { width: 360, height: 740 };
const SCREENS = ".superpowers/screens-D2";
/** Phone-track evidence (spec §4.7): light, dark and forced colours. */
const PHONE_SCREENS = ".superpowers/screens-r2-phone";
/** The narrowest common phone (iPhone SE / mini class). */
const PHONE_375 = { width: 375, height: 812 };

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

/**
 * Opens the phone colour panel. Pass `touch` inside a `hasTouch` context:
 * it keeps the context's viewport and taps instead of clicking.
 */
async function openPhonePanel(page: Page, { touch = false } = {}) {
  if (!touch) await page.setViewportSize(PHONE);
  await openToolbarTestDoc(page);
  await selectNewParagraph(page);
  const entry = page
    .getByRole("toolbar")
    .getByRole("button", { name: "Text style and colour" });
  if (touch) await entry.tap();
  else await entry.click();
}

const toolbar = (page: Page) => page.getByRole("toolbar");

/** Every visible control in `scope` with its box, for the 44px rule. */
const smallTargets = (page: Page, selector: string) =>
  page.locator(selector).evaluateAll((els) =>
    els
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => {
        const box = el.getBoundingClientRect();
        return {
          name: el.getAttribute("aria-label") ?? el.textContent ?? "",
          width: Math.round(box.width),
          height: Math.round(box.height),
        };
      })
      .filter((box) => box.width < 44 || box.height < 44),
  );

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
  await expect(blue).not.toHaveAttribute("aria-disabled", "true");
  // PR C registers the text colour mark, so its swatches are live here.
  const red = dialog
    .getByRole("group", { name: "Text colour" })
    .getByRole("button", { name: "Red text" });
  await expect(red).not.toHaveAttribute("aria-disabled", "true");
  // Arrow keys move focus only: nothing is applied.
  await expect(
    dialog.getByRole("button", { name: "No highlight" }),
  ).toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect(await lastHighlight(page)).toBeNull();
  // Applying keeps the popover open (spec §4.5, O4); Esc closes it.
  await blue.click();
  await expect(blue).toHaveAttribute("aria-pressed", "true");
  expect(await lastHighlight(page)).toBe("blue");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

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

test("size spinbutton keeps Home, End and Enter from the toolbar", async ({
  page,
}) => {
  await openPhonePanel(page);
  const spin = toolbar(page).getByRole("spinbutton", { name: "Font size" });
  const back = toolbar(page).getByRole("button", {
    name: "Back to all tools",
  });
  // Rove left to Back so the toolbar's roving index points at it…
  await spin.focus();
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(back).toBeFocused();
  // …then click into the spinbutton: Enter must not click Back.
  await spin.click({ force: true });
  await expect(spin).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(spin).toBeVisible();
  await expect(spin).toBeFocused();
  for (const key of ["Home", "End", "ArrowUp", "ArrowDown"]) {
    await page.keyboard.press(key);
    await expect(spin, `${key} keeps focus`).toBeFocused();
  }
  // ←/→ still rove.
  await page.keyboard.press("ArrowRight");
  await expect(
    toolbar(page).getByRole("button", { name: "Increase font size" }),
  ).toBeFocused();
});

test("colour swatches keep their colours in forced colours", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ forcedColors: "active" });
  await openPhonePanel(page);
  const more = toolbar(page).getByRole("button", {
    name: "More highlight colours",
  });
  await more.click();
  const dialog = page.getByRole("dialog", { name: "Highlight colours" });
  await dialog.getByRole("button", { name: "Blue highlight" }).click();
  const highlights = dialog.getByRole("group", { name: "Highlight" });
  const blue = highlights.getByRole("button", { name: "Blue highlight" });
  await expect(blue).toHaveAttribute("aria-pressed", "true");
  const styles = await highlights.getByRole("button").evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      return {
        token: el.getAttribute("data-token"),
        adjust: cs.forcedColorAdjust,
        bg: cs.backgroundColor,
        shadow: cs.boxShadow,
      };
    }),
  );
  for (const style of styles) expect(style.adjust).toBe("none");
  // Each highlight swatch shows its own colour.
  const colours = new Set(
    styles.filter((style) => style.token !== "none").map((style) => style.bg),
  );
  expect(colours.size).toBe(styles.length - 1);
  // Pressed is a ring, not the focus outline, and keeps the swatch's own
  // fill (the global forced-colours rule paints pressed buttons Highlight).
  const pressed = styles.find((style) => style.token === "blue");
  expect(pressed?.shadow).not.toBe("none");
  const systemHighlight = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.background = "Highlight";
    document.body.appendChild(probe);
    const colour = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return colour;
  });
  expect(pressed?.bg).not.toBe(systemHighlight);
  const face = await toolbar(page)
    .locator(".st-face-bar--highlight")
    .evaluate((el) => getComputedStyle(el).forcedColorAdjust);
  expect(face).toBe("none");
  await page.mouse.move(0, PHONE.height - 1);
  await testInfo.attach("colour-popover-forced-colors", {
    body: await dialog.screenshot(),
    contentType: "image/png",
  });
  await dialog.screenshot({
    path: `${SCREENS}/phone-colour-popover-forced.png`,
  });
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

test.describe("on a touch phone (coarse pointer, 360px)", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: TOUCH_PHONE });

  test("targets are 44×44 and nothing scrolls sideways", async ({ page }) => {
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    ).toBe(true);
    await openPhonePanel(page, { touch: true });
    await expect(
      toolbar(page).getByRole("spinbutton", { name: "Font size" }),
    ).toBeVisible();

    const controls =
      '[role="toolbar"] button, [role="toolbar"] [role="spinbutton"]';
    expect(await smallTargets(page, controls)).toEqual([]);
    const overflow = await toolbar(page).evaluate(
      (el) => el.scrollWidth - el.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${SCREENS}/touch-phone-panel.png` });

    // A tap opens the popover without moving focus into it, so a tap from
    // the editor keeps the phone keyboard up. (The entry button that opens
    // this panel already takes focus on touch: D1's main toolbar.)
    const focusedBefore = await page.evaluateHandle(
      () => document.activeElement,
    );
    await toolbar(page)
      .getByRole("button", { name: "More highlight colours" })
      .tap();
    const dialog = page.getByRole("dialog", { name: "Highlight colours" });
    await expect(dialog).toBeVisible();
    await dialog.evaluate((el) =>
      Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)),
    );
    expect(
      await page.evaluate(
        (before) => document.activeElement === before,
        focusedBefore,
      ),
    ).toBe(true);
    expect(
      await smallTargets(page, '[role="dialog"] button.st-swatch'),
    ).toEqual([]);
    const box = await dialog.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(TOUCH_PHONE.width);
    }
    expect(
      await dialog.evaluate((el) => el.scrollWidth - el.clientWidth),
    ).toBeLessThanOrEqual(1);
    await page.screenshot({ path: `${SCREENS}/touch-colour-popover.png` });

    // ↑/↓ follow the visual lines of six swatches.
    const highlights = dialog.getByRole("group", { name: "Highlight" });
    const none = highlights.getByRole("button", { name: "No highlight" });
    await none.focus();
    await page.keyboard.press("ArrowDown");
    await expect(highlights.locator('[data-col="6"]')).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(none).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(
      dialog
        .getByRole("group", { name: "Text colour" })
        .locator('[data-col="6"]'),
    ).toBeFocused();
  });
});

/**
 * v1 phone minimum (contract §1.3, D2 KEEP): at 375px on touch, the existing
 * mobile panel reaches text colour, highlight and size with 44×44 targets.
 * This pins the current panel only: it opens it through the old "Text style
 * and colour" entry and finds the controls in `role="toolbar"`. When the
 * docked bar and Aa sheet (a dialog) replace `MobileToolbarContent`, move
 * this block to the sheet in the same change; it does not prove parity on
 * its own.
 */
test.describe("on a 375px touch phone", () => {
  test.use({ hasTouch: true, isMobile: true, viewport: PHONE_375 });

  /** Mark attribute on the last paragraph's text, or null. */
  const lastMark = (page: Page, mark: string, attr: string) =>
    page.evaluate(
      ([name, key]) => {
        const doc = window.__tiptap_editor?.state.doc;
        const found = doc?.lastChild?.firstChild?.marks.find(
          (m) => m.type.name === name,
        );
        return (found?.attrs[key] as string | undefined) ?? null;
      },
      [mark, attr] as const,
    );

  for (const mode of ["light", "dark", "forced"] as const) {
    test(`colour and size apply with 44×44 targets (${mode})`, async ({
      page,
    }) => {
      if (mode === "forced")
        await page.emulateMedia({ forcedColors: "active" });
      else await setTheme(page, mode);
      await openPhonePanel(page, { touch: true });

      const controls =
        '[role="toolbar"] button, [role="toolbar"] [role="spinbutton"]';
      expect(await smallTargets(page, controls)).toEqual([]);
      expect(
        await toolbar(page).evaluate((el) => el.scrollWidth - el.clientWidth),
      ).toBeLessThanOrEqual(1);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      ).toBeLessThanOrEqual(0);
      await expectNoSeriousA11yViolations(page, ['[role="toolbar"]']);

      const textFace = toolbar(page).getByRole("button", {
        name: /^Apply text colour: /,
      });
      const highlightFace = toolbar(page).getByRole("button", {
        name: /^Apply highlight: /,
      });
      // The faces name the colour they apply ("Apply text colour: Red").
      const faceToken = async (face: typeof textFace) =>
        ((await face.getAttribute("aria-label")) ?? "")
          .replace(/^.*: /, "")
          .toLowerCase();
      const textToken = await faceToken(textFace);
      const highlightToken = await faceToken(highlightFace);

      await textFace.tap();
      await highlightFace.tap();
      await toolbar(page)
        .getByRole("button", { name: "Increase font size" })
        .tap();
      await expect
        .poll(() => lastMark(page, "textColor", "color"))
        .toBe(textToken);
      await expect.poll(() => lastHighlight(page)).toBe(highlightToken);
      await expect.poll(() => lastMark(page, "fontSize", "size")).toBe("lg");
      // What is on screen and exposed to assistive tech follows the mark
      // (WCAG 4.1.2); this also waits out the toolbar settle delay.
      const stepper = toolbar(page).getByRole("spinbutton", {
        name: "Font size",
      });
      await expect(stepper).toHaveAttribute("aria-valuetext", /^Large/);
      await expect(stepper).toHaveText("L");

      await page.screenshot({
        path: `${PHONE_SCREENS}/phone-panel-${mode}.png`,
      });
    });
  }
});
