import { type Browser, test } from "@playwright/test";

import { EditorPage } from "./helpers/editor-page";
import { freezePage, PAGE_FIXTURE } from "./helpers/page-fixture";

/*
 * Design-review screenshots for the page engine (P2.9c-1), by hand only:
 *   PAGE_SHOTS_DIR=<dir> CI= bun playwright test tests/e2e/page-design-shots.spec.ts --project=chromium
 * Every text size and width, spacing, reading mode, both themes,
 * increased contrast, right-to-left text and phone width.
 */

const DIR = process.env.PAGE_SHOTS_DIR;

interface Shot {
  name: string;
  look?: "new" | "classic";
  page?: Record<string, unknown>;
  slots?: Record<string, unknown>;
  dark?: boolean;
  width?: number;
  height?: number;
  phone?: boolean;
  reading?: boolean;
  rtl?: boolean;
}

const SHOTS: Shot[] = [
  { name: "default-16-light" },
  { name: "default-16-dark", dark: true },
  { name: "classic-light", look: "classic" },
  { name: "classic-dark", look: "classic", dark: true },
  ...[14, 18, 20, 24, 28, 32].map((size) => ({
    name: `size-${size}`,
    page: { size },
    width: 1600,
  })),
  ...["narrow", "wide", "full"].map((width) => ({
    name: `width-${width}`,
    page: { width },
    width: 1600,
  })),
  { name: "width-full-24", page: { width: "full", size: 24 }, width: 1600 },
  { name: "spacing-compact", page: { spacing: "compact" } },
  { name: "spacing-relaxed", page: { spacing: "relaxed" } },
  { name: "reading-mode", reading: true },
  { name: "reading-mode-dark", reading: true, dark: true },
  { name: "contrast-light", slots: { a11y: { contrast: "more" } } },
  { name: "contrast-dark", slots: { a11y: { contrast: "more" } }, dark: true },
  { name: "rtl-persian", rtl: true },
  { name: "phone-default", phone: true },
  { name: "phone-24", phone: true, page: { size: 24 } },
  { name: "phone-classic", phone: true, look: "classic" },
  { name: "phone-dark", phone: true, dark: true },
];

const PERSIAN = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1 },
      content: [{ type: "text", text: "یادداشت‌های جلسه" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "این یک پاراگراف فارسی است که برای بررسی فاصله‌ی خطوط، اندازه‌ی متن و نیم‌فاصله در ویرایشگر نوشته شده است. متن باید از راست به چپ و بدون شکستن اتصال حروف نمایش داده شود.",
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 2 },
      content: [{ type: "text", text: "کارهای بعدی" }],
    },
    {
      type: "bulletList",
      content: ["بازبینی طراحی", "اندازه‌گیری حجم", "انتشار"].map((item) => ({
        type: "listItem",
        content: [
          { type: "paragraph", content: [{ type: "text", text: item }] },
        ],
      })),
    },
  ],
};

async function capture(browser: Browser, baseURL: string, shot: Shot) {
  const context = await browser.newContext({
    baseURL,
    viewport: shot.phone
      ? { width: 375, height: 812 }
      : { width: shot.width ?? 1280, height: shot.height ?? 900 },
    deviceScaleFactor: shot.phone ? 2 : 1,
    isMobile: shot.phone,
    hasTouch: shot.phone,
    colorScheme: shot.dark ? "dark" : "light",
  });
  const page = await context.newPage();
  await page.addInitScript(
    ({ look, slots, dark }) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("tinydocy-theme", dark ? "dark" : "light");
      localStorage.setItem("tinydocy-look", look);
      localStorage.setItem(
        "tinydocy-user",
        JSON.stringify({ name: "Quiet Otter", color: "#958DF1" }),
      );
      localStorage.setItem(
        "tinydocy-ui",
        JSON.stringify({
          v: 1,
          slots: Object.fromEntries(
            Object.entries(slots).map(([name, last]) => [
              name,
              { last, recent: [] },
            ]),
          ),
        }),
      );
    },
    {
      look: shot.look ?? "new",
      dark: Boolean(shot.dark),
      slots: {
        ...(shot.page ? { page: { style: "default", ...shot.page } } : {}),
        ...shot.slots,
      },
    },
  );
  const editor = new EditorPage(page);
  await editor.goto();
  await editor.waitForSync();
  await editor.setContent(shot.rtl ? PERSIAN : PAGE_FIXTURE);
  if (shot.rtl) {
    // Paragraph direction arrives with P2.13; the page engine is checked
    // here with the whole document set right to left.
    await page.evaluate(() => {
      document.querySelector(".tiptap")?.setAttribute("dir", "rtl");
    });
  }
  if (shot.reading) {
    await page.waitForFunction(() => window.__tinydocyPrefs !== undefined);
    await page.evaluate(() => window.__tinydocyPrefs?.setReadingMode(true));
  }
  await freezePage(page);
  await page.screenshot({ path: `${DIR}/${shot.name}.png` });
  await context.close();
}

test("page engine design screenshots", async ({ browser, baseURL }) => {
  test.skip(!DIR, "set PAGE_SHOTS_DIR");
  test.setTimeout(600_000);
  for (const shot of SHOTS) await capture(browser, baseURL as string, shot);
});
