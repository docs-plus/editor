import { expect, test } from "@playwright/test";
import { assertInvariantsFromJSON } from "@/tests/helpers/assert-invariants";
import { generateLargeDocument } from "@/tests/helpers/document-generators";
import { EditorPage } from "./helpers/editor-page";
import { SoakBot } from "./helpers/soak-bot";

const SOAK_DURATION = Number(process.env.SOAK_DURATION ?? 1_800_000);

test.setTimeout(SOAK_DURATION + 300_000);

test("multi-user soak — 2 users editing concurrently with schema checks", async ({
  browser,
}) => {
  const [ctxA, ctxB] = await Promise.all([
    browser.newContext(),
    browser.newContext(),
  ]);
  const [pageA, pageB] = await Promise.all([ctxA.newPage(), ctxB.newPage()]);
  const [epA, epB] = [new EditorPage(pageA), new EditorPage(pageB)];

  const docId = `soak-collab-${Date.now()}`;
  await Promise.all([epA.goto(docId), epB.goto(docId)]);
  await Promise.all([epA.waitForSync(), epB.waitForSync()]);

  await epA.setContent(generateLargeDocument(100));
  await pageA.waitForTimeout(2000);

  const bots = [new SoakBot(epA, pageA), new SoakBot(epB, pageB)];
  const editors = [epA, epB];

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

  await Promise.all([pageA.waitForTimeout(5000), pageB.waitForTimeout(5000)]);

  const [jsonA, jsonB] = await Promise.all([
    epA.getEditorJSON(),
    epB.getEditorJSON(),
  ]);
  expect(JSON.stringify(jsonA)).toBe(JSON.stringify(jsonB));

  assertInvariantsFromJSON(
    jsonA as {
      content?: Array<{ type?: string; attrs?: Record<string, unknown> }>;
    },
  );

  for (const [i, r] of results.entries()) {
    console.log(
      `[soak-collab] User ${i}: ${r.totalActions} actions, ${r.errors.length} errors`,
    );
  }

  await Promise.all([ctxA.close(), ctxB.close()]);
});
