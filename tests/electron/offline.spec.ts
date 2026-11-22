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

import { firstPage, HOCUS_PORT, launch, ROOT, startHocus } from "./helpers";
import { nonLoopback, parseNetLog, scanNetLog } from "./netlog";

const EDITOR = '.tiptap[contenteditable="true"]';
const RESULTS = join(ROOT, "test-results-electron");

/**
 * Hosts allowed to appear, each with its reason. Exact names; keep it short.
 * - `[2001:4860:4860::8888]` (every OS): Chromium's IPv6 reachability
 *   probe. The resolver `connect()`s a UDP socket to Google's public DNS
 *   address to learn whether an IPv6 route exists; a UDP connect sends no
 *   packet, so nothing leaves the machine (measured on all three runners).
 * - `wpad` (Windows): the proxy auto-detect DNS lookup Chromium makes on
 *   every Windows start whatever the app does (spike S1); a lookup, never
 *   a connection.
 */
const IPV6_PROBE = "[2001:4860:4860::8888]";
const ALLOWED: Partial<Record<NodeJS.Platform, string[]>> = {
  darwin: [IPV6_PROBE],
  linux: [IPV6_PROBE],
  win32: [IPV6_PROBE, "wpad"],
};

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
  // A canary the log must show: one loopback request from main's network
  // stack. The renderer itself now makes none (storage is local).
  await app.evaluate(async ({ net }, port) => {
    await net.fetch(`http://127.0.0.1:${port}/`).catch(() => undefined);
  }, HOCUS_PORT);

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
  const { hosts, unparsed } = scanNetLog(text);
  const leaving = nonLoopback(hosts, ALLOWED[process.platform] ?? []);
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(
    join(RESULTS, `netlog-hosts-${process.platform}.json`),
    `${JSON.stringify({ platform: process.platform, hosts, leaving, unparsed }, null, 2)}\n`,
  );
  console.log(
    `[netlog] ${process.platform}`,
    JSON.stringify({ hosts, leaving, unparsed }),
  );

  // The log recorded the session: it parses and shows the canary.
  expect(parseNetLog(text).events?.length ?? 0).toBeGreaterThan(0);
  expect(hosts).toContain("127.0.0.1");
  expect(leaving).toEqual([]);
  // Fail closed: a peer we couldn't read counts as one.
  expect(unparsed).toEqual([]);
  // #100: no Hunspell dictionary host, ever (it isn't on any allowlist).
  expect(hosts.filter((host) => /(^|\.)gvt1\.com$/.test(host))).toEqual([]);
});
