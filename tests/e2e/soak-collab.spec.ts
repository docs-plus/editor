import type { BrowserContext, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { assertInvariantsFromJSON } from "@/tests/helpers/assert-invariants-json";
import { generateLargeDocument } from "@/tests/helpers/document-generators";
import { EditorPage } from "./helpers/editor-page";
import { SoakBot } from "./helpers/soak-bot";

const SOAK_USERS = Number(process.env.SOAK_USERS ?? 3);
const SOAK_DURATION = Number(process.env.SOAK_DURATION ?? 1_800_000);
const SOAK_HEADINGS = Number(process.env.SOAK_HEADINGS ?? 20);

test.setTimeout(SOAK_DURATION + 300_000);

test(`multi-user soak — ${SOAK_USERS} users editing concurrently with schema checks`, async ({
  browser,
}) => {
  const docId = `soak-collab-${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  const editors: EditorPage[] = [];

  const ctx0 = await browser.newContext();
  const page0 = await ctx0.newPage();
  await page0.addInitScript(
    `window.__HOCUS_TOKEN = ${JSON.stringify(`soak-user-0-${docId}`)}`,
  );
  const ep0 = new EditorPage(page0);
  await ep0.goto(docId);
  await ep0.waitForSync();
  await ep0.setContent(generateLargeDocument(SOAK_HEADINGS));
  await expect(page0.locator(".tiptap")).toContainText("Soak Test Document", {
    timeout: 10000,
  });
  await page0.waitForTimeout(2000);

  contexts.push(ctx0);
  pages.push(page0);
  editors.push(ep0);

  for (let i = 1; i < SOAK_USERS; i++) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.addInitScript(
      `window.__HOCUS_TOKEN = ${JSON.stringify(`soak-user-${i}-${docId}`)}`,
    );
    const ep = new EditorPage(page);
    await ep.goto(docId);
    await ep.waitForSync();
    await expect(page.locator(".tiptap")).toContainText("Soak Test Document", {
      timeout: 30000,
    });
    contexts.push(ctx);
    pages.push(page);
    editors.push(ep);
  }

  const bots = editors.map((ep, i) => new SoakBot(ep, pages[i]));

  console.log(
    `[soak-collab] Starting: ${SOAK_USERS} users, ${SOAK_HEADINGS} headings (rich content), ${SOAK_DURATION / 1000}s duration`,
  );

  const results = await Promise.all(
    bots.map((bot, i) =>
      bot.runFor(SOAK_DURATION, {
        delayBetweenMs: 300,
        intervalMs: 60_000,
        onInterval: async () => {
          const json = await editors[i].getEditorJSON();
          try {
            assertInvariantsFromJSON(
              json as {
                content?: Array<{
                  type?: string;
                  attrs?: Record<string, unknown>;
                }>;
              },
            );
          } catch (err) {
            console.error(
              `[schema] User ${i} invariant violation:`,
              (err as Error).message,
            );
            throw err;
          }
        },
      }),
    ),
  );

  await Promise.all(pages.map((p) => p.waitForTimeout(5000)));

  const allJson = await Promise.all(editors.map((ep) => ep.getEditorJSON()));
  const refJson = JSON.stringify(allJson[0]);
  for (let i = 1; i < allJson.length; i++) {
    expect(
      JSON.stringify(allJson[i]),
      `User ${i} document diverged from User 0`,
    ).toBe(refJson);
  }

  assertInvariantsFromJSON(
    allJson[0] as {
      content?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
    },
  );

  for (const [i, r] of results.entries()) {
    console.log(
      `[soak-collab] User ${i}: ${r.totalActions} actions, ${r.errors.length} errors`,
    );
  }

  await Promise.all(contexts.map((ctx) => ctx.close()));
});
