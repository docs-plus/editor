/**
 * Document links (LK1) on the library harness's links view
 * (`tests/harness/library/links-view.tsx`): each search-linking §4.6 state
 * draws, links follow (Mod opens here, Mod+Shift or middle-click a new
 * tab), `here#` jumps in place, a missing heading says so, and no
 * `tinydocy:` href ever reaches the external opener. Runs in the `library`
 * project with the harness started.
 */
import { expect, type Page, test } from "@playwright/test";

const editor = (page: Page) => page.locator(".h-editor .ProseMirror");
const linkTo = (page: Page, text: string) =>
  editor(page).locator("a", { hasText: text });
const lastOpen = (page: Page) => page.getByTestId("last-open");
const external = (page: Page) => page.getByTestId("external");
const follows = (page: Page) => page.getByTestId("follows");
/** `announce()`'s live region (dnd-kit keeps one of its own). */
const said = (page: Page) =>
  page.locator('body > div[role="status"]:not([id^="DndLiveRegion"])');

/** The heading the caret sits in, if any. */
const caretHeading = (page: Page) =>
  page.evaluate(() => {
    const node = window.getSelection()?.anchorNode ?? null;
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest("h1")?.textContent ?? null;
  });

test.beforeEach(async ({ page }) => {
  await page.goto("/?view=links");
  await expect(editor(page)).toBeVisible();
});

test("every link state draws its icon, broken ones with a dashed underline", async ({
  page,
}) => {
  const states = await editor(page)
    .locator(".doc-link-icon")
    .evaluateAll((icons) =>
      icons.map((icon) => (icon as HTMLElement).dataset.linkState),
    );
  expect(states).toEqual([
    "resolves",
    "resolves",
    "resolves",
    "in_trash",
    "not_available",
    "not_available",
    "invalid",
    "unknown_form",
    "here",
  ]);
  // States that don't open start the link's accessible name (§7).
  await expect(
    page.getByRole("link", { name: /^In Trash.*Old plan/ }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: /^Not available.*Someone else's/ }),
  ).toHaveCount(1);
  await expect(page.getByRole("link", { name: /^Q4 budget$/ })).toHaveCount(1);
  // External links get no icon (no favicon request either).
  await expect(
    linkTo(page, "example.com").locator(".doc-link-icon"),
  ).toHaveCount(0);
  for (const text of [
    "A deleted note",
    "Someone else's",
    "A broken link",
    "From the future",
  ]) {
    await expect(linkTo(page, text)).toHaveCSS(
      "text-decoration-style",
      "dashed",
    );
  }
  await expect(linkTo(page, "Q4 budget").first()).not.toHaveCSS(
    "text-decoration-style",
    "dashed",
  );
});

test("Mod-click follows in this tab, then to the heading", async ({ page }) => {
  await linkTo(page, "Q4 budget › Travel").click({
    modifiers: ["ControlOrMeta"],
  });
  await expect(lastOpen(page)).toHaveText("d-budget current");
  await expect(page.locator('[data-doc="d-budget"]')).toBeVisible();
  await expect.poll(() => caretHeading(page)).toBe("Travel");
  await expect(follows(page)).toHaveText("1");
  await expect(external(page)).toHaveText("");
});

test("Mod+Shift-click and middle-click open a new tab", async ({ page }) => {
  await linkTo(page, "Q4 budget")
    .first()
    .click({ modifiers: ["ControlOrMeta", "Shift"] });
  await expect(lastOpen(page)).toHaveText("d-budget tab");
  await expect(page.locator('[data-doc="d-demo"]')).toBeVisible();

  await page.getByTestId("last-open").evaluate((node) => {
    node.textContent = "";
  });
  await linkTo(page, "Old plan").click({ button: "middle" });
  await expect(lastOpen(page)).toHaveText("d-old tab");
  await expect(external(page)).toHaveText("");
});

test("a here# link jumps in place; a missing heading says so", async ({
  page,
}) => {
  await linkTo(page, "Second section").click({ modifiers: ["ControlOrMeta"] });
  await expect.poll(() => caretHeading(page)).toBe("Second section");
  await expect(follows(page)).toHaveText("1");

  await linkTo(page, "Q4 budget › Gone").click({
    modifiers: ["ControlOrMeta"],
  });
  await expect(page.locator('[data-doc="d-budget"]')).toBeVisible();
  await expect(said(page)).toHaveText(
    "The section this link pointed to was removed.",
  );
});

test("a link that doesn't open shows its preview, never its key", async ({
  page,
}) => {
  const card = page.locator(".doc-link-preview");
  for (const text of ["A deleted note", "Someone else's"]) {
    await linkTo(page, text).click({ modifiers: ["ControlOrMeta"] });
    await expect(card).toContainText("This document isn't on this device.");
    await expect(card).not.toContainText(/tinydocy:|[0-9a-f]{32}/);
    // Remove Link is never where focus starts.
    const first = card.getByRole("button").first();
    await expect(first).not.toHaveText("Remove Link");
    await page.keyboard.press("Escape");
    await expect(card).toHaveCount(0);
  }
  // Invalid and later-version links: their preview explains, and nothing
  // opens.
  await linkTo(page, "A broken link").click();
  await expect(card).toContainText("This link isn't valid.");
  await page.keyboard.press("Escape");
  await linkTo(page, "From the future").click();
  await expect(card).toContainText("needs a newer version");
  await page.keyboard.press("Escape");
  await expect(follows(page)).toHaveText("0");
  await expect(lastOpen(page)).toHaveText("");
  await expect(external(page)).toHaveText("");

  await linkTo(page, "Old plan").click({ modifiers: ["ControlOrMeta"] });
  await expect(lastOpen(page)).toHaveText("d-old current");
});

test("the document preview shows the title and path, and Esc returns to the link", async ({
  page,
}) => {
  const link = linkTo(page, "Q4 budget").first();
  await link.click();
  const card = page.locator(".doc-link-preview");
  await expect(card).toContainText("Q4 budget");
  await expect(card).toContainText("Library › Work");
  await expect(card).not.toContainText(/tinydocy:|[0-9a-f]{32}/);
  await expect(card.getByRole("button")).toHaveText([
    "Open",
    "Copy Link",
    "Remove Link",
  ]);
  await page.keyboard.press("Escape");
  await expect(card).toHaveCount(0);
  const inLink = await page.evaluate(() => {
    const node = window.getSelection()?.anchorNode ?? null;
    const element = node instanceof Element ? node : node?.parentElement;
    return element?.closest("a")?.textContent ?? null;
  });
  expect(inLink).toContain("Q4 budget");
});

/**
 * Every gesture, editing and read-only, as the extension and our navigate
 * handle them today. Nothing ever requests a tinydocy: URL or navigates the
 * page. Read-only click and Enter show the preview (whose Open follows);
 * §4.3's "click opens in reading mode" needs the host wiring (LK2, Q8).
 */
const GESTURES: [string, string, { editing: string; readOnly: string }][] = [
  ["click", "", { editing: "preview", readOnly: "preview" }],
  ["mod-click", "", { editing: "current", readOnly: "current" }],
  ["mod-shift-click", "", { editing: "tab", readOnly: "tab" }],
  ["middle-click", "", { editing: "tab", readOnly: "tab" }],
  ["key", "Enter", { editing: "preview", readOnly: "preview" }],
  ["key", "Alt+Enter", { editing: "current", readOnly: "preview" }],
  ["key", "ControlOrMeta+Enter", { editing: "preview", readOnly: "current" }],
  ["key", "ControlOrMeta+Shift+Enter", { editing: "preview", readOnly: "tab" }],
];

for (const readOnly of [false, true]) {
  for (const [kind, key, outcome] of GESTURES) {
    const expected = readOnly ? outcome.readOnly : outcome.editing;
    test(`gesture table: ${kind} ${key} ${readOnly ? "read-only" : "editing"} → ${expected}`, async ({
      page,
    }) => {
      const outside: string[] = [];
      page.on("request", (request) => {
        if (!request.url().startsWith("http://127.0.0.1")) {
          outside.push(request.url());
        }
      });
      let navigations = 0;
      page.on("framenavigated", () => {
        navigations += 1;
      });
      if (readOnly) await page.getByTestId("readonly-toggle").click();
      const link = linkTo(page, "Q4 budget").first();
      const box = await link.boundingBox();
      if (!box) throw new Error("no link box");
      const x = box.x + box.width / 2 + 8;
      const y = box.y + box.height / 2;
      const mod = process.platform === "darwin" ? "Meta" : "Control";
      if (kind === "click") await page.mouse.click(x, y);
      if (kind === "mod-click" || kind === "mod-shift-click") {
        await page.keyboard.down(mod);
        if (kind === "mod-shift-click") await page.keyboard.down("Shift");
        await page.mouse.click(x, y);
        await page.keyboard.up("Shift");
        await page.keyboard.up(mod);
      }
      if (kind === "middle-click")
        await page.mouse.click(x, y, { button: "middle" });
      if (kind === "key") {
        if (readOnly) {
          await link.focus();
        } else {
          await page.mouse.click(x, y);
          await page.keyboard.press("Escape");
        }
        await page.keyboard.press(key);
      }
      if (expected === "preview") {
        await expect(page.locator(".doc-link-preview")).toHaveCount(1);
        await expect(lastOpen(page)).toHaveText("");
      } else {
        await expect(lastOpen(page)).toHaveText(`d-budget ${expected}`);
      }
      expect(outside).toEqual([]);
      expect(navigations).toBe(0);
    });
  }
}

test("only web links reach the external opener", async ({ page }) => {
  await linkTo(page, "example.com").click({ modifiers: ["ControlOrMeta"] });
  await expect(external(page)).toHaveText("https://example.com/");
});

test("icons follow the library: trashing the target redraws its links", async ({
  page,
}) => {
  await page.evaluate(() =>
    (
      window as unknown as {
        __library: { trash(ids: string[]): Promise<unknown> };
      }
    ).__library.trash(["d-budget"]),
  );
  await expect(
    linkTo(page, "Q4 budget").first().locator(".doc-link-icon"),
  ).toHaveAttribute("data-link-state", "in_trash");
  await expect(
    page.getByRole("link", { name: /^In Trash.*Q4 budget/ }).first(),
  ).toBeVisible();
});
