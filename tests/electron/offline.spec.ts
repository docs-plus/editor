/**
 * The offline proof (plan §7; offline data-model audit; SEC-002): a whole
 * session (start, open the editor, type, quit) makes no request that leaves
 * the machine. Chromium's own net-log records every URL request, socket and
 * DNS lookup, so this catches what the page's CSP report can't: Hunspell
 * dictionary downloads (#100), proxy auto-detect, prefetches.
 *
 * There is no update check yet (P3.3), so the expected number of
 * non-loopback hosts is zero, apart from the allowlist below. The sync
 * server in CI is loopback Hocus.
 */
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, test } from "@playwright/test";

import { firstPage, launch, ROOT, startHocus } from "./helpers";
import { hostsInNetLog, nonLoopback, parseNetLog } from "./netlog";

const EDITOR = '.tiptap[contenteditable="true"]';
const RESULTS = join(ROOT, "test-results-electron");

/**
 * Hosts allowed to appear, each with its reason. Keep this list short.
 * - `wpad`: Windows' proxy auto-detect DNS lookup. Chromium makes it on
 *   every Windows start whatever the app does (spike S1, every Windows
 *   net-log); it is a lookup, never a connection.
 */
const ALLOWED: Record<NodeJS.Platform, RegExp[]> = {
  win32: [/^wpad$/],
} as Record<NodeJS.Platform, RegExp[]>;

let hocus: Awaited<ReturnType<typeof startHocus>> | null = null;

test.beforeAll(async () => {
  hocus = await startHocus(
    join(mkdtempSync(join(tmpdir(), "tinydocy-hocus-")), "db.sqlite"),
  );
});
test.afterAll(async () => {
  hocus?.kill();
  await hocus?.exited;
});

test("a session from start to quit sends nothing off the machine", async () => {
  const netLog = join(
    mkdtempSync(join(tmpdir(), "tinydocy-netlog-")),
    "net.json",
  );
  const launched = await launch({
    // Chromium switches: the app's argv filter skips them.
    args: [`--log-net-log=${netLog}`, "--net-log-capture-mode=Default"],
  });
  const { app, exited } = launched;
  const page = await firstPage(app);
  await page.locator(EDITOR).first().waitFor({ timeout: 60_000 });
  await page.locator(EDITOR).first().click();
  await page.keyboard.type("Offline check: a mispeled wrod and some text. ");
  // Long enough for a spellcheck dictionary fetch or a prefetch to start.
  await page.waitForTimeout(5000);

  // Quit through the app so Chromium closes the net-log cleanly.
  await app.evaluate(({ app: electronApp }) => {
    setTimeout(() => electronApp.quit(), 0);
  });
  const code = await Promise.race([
    exited,
    new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 15_000)),
  ]);
  expect(code).toBe(0);

  const text = readFileSync(netLog, "utf8");
  const hosts = hostsInNetLog(text);
  const leaving = nonLoopback(hosts, ALLOWED[process.platform] ?? []);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(
    join(RESULTS, `netlog-hosts-${process.platform}.json`),
    `${JSON.stringify({ platform: process.platform, hosts, leaving }, null, 2)}\n`,
  );
  console.log(
    `[netlog] ${process.platform}`,
    JSON.stringify({ hosts, leaving }),
  );

  // The log must have recorded the session at all.
  expect(parseNetLog(text).events?.length ?? 0).toBeGreaterThan(50);
  expect(leaving).toEqual([]);
  // #100: no Hunspell dictionary host, ever (it isn't on any allowlist).
  expect(hosts.filter((host) => /(^|\.)gvt1\.com$/.test(host))).toEqual([]);
});
