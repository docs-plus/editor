/**
 * Shell hardening on the packaged app (#135 security review):
 * - SEC-003: only the app's own top frame may send a link to the system
 *   browser, a few times per window at most; a subframe can neither
 *   window.open one nor navigate the top window to one;
 * - SEC-004: downloads are refused;
 * - SEC-008: non-HTML responses (scripts, SVG, 404s) carry a CSP too.
 *
 * The probe subframe is an `about:blank` iframe: the desktop CSP's
 * `frame-src` admits no other origin we could load offline, and what the
 * shell checks is "not the top app frame", which it is. Playwright runs
 * code in it through the debugger, so the page's CSP doesn't block that.
 */
import { expect, type Frame, type Page, test } from "@playwright/test";

import {
  type DiagnosticEvent,
  diagnostics,
  firstPage,
  type Launched,
  launch,
  waitForEvent,
} from "./helpers";

let current: Launched | null = null;
test.afterEach(async () => {
  const launched = current;
  current = null;
  if (!launched || launched.hasExited()) return;
  await launched.app.close().catch(() => undefined);
});

const count = (events: DiagnosticEvent[], event: string) =>
  events.filter((e) => e.event === event).length;

/** Adds a visible `about:blank` iframe and returns its Playwright frame. */
async function addProbeFrame(page: Page): Promise<Frame> {
  await page.evaluate(() => {
    const frame = document.createElement("iframe");
    frame.id = "probe";
    frame.style.cssText =
      "position:fixed;top:8px;left:8px;width:160px;height:120px;z-index:2147483647;border:0;background:#fff";
    document.body.append(frame);
  });
  await expect
    .poll(() => page.frames().filter((f) => f !== page.mainFrame()).length)
    .toBeGreaterThan(0);
  const frame = page
    .frames()
    .find((f) => f !== page.mainFrame() && f.url() === "about:blank");
  if (!frame) throw new Error("no probe frame");
  await frame.evaluate(() => {
    document.body.style.cssText = "margin:0;height:120px";
  });
  return frame;
}

test("a subframe can't send a link to the browser, by window.open or by navigating the top window", async () => {
  current = await launch();
  const { app } = current;
  const page = await firstPage(app);
  const probe = await addProbeFrame(page);

  // Navigating the top window from the subframe: refused, no browser.
  await probe.evaluate(() => {
    (window.top as Window).location.href = "https://example.com/from-frame";
  });
  await waitForEvent(app, "navigation_refused");
  await waitForEvent(app, "external_open_refused", (e) => e.reason === "frame");

  // window.open after the user clicked into the subframe: refused too.
  await page.locator("#probe").click({ position: { x: 20, y: 20 } });
  await expect
    .poll(() =>
      app.evaluate(
        ({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.webContents.focusedFrame?.url ??
          null,
      ),
    )
    .toBe("about:blank");
  const before = count(await diagnostics(app), "external_open_refused");
  const opened = await probe.evaluate(
    () => window.open("https://example.com/popup") === null,
  );
  expect(opened).toBe(true);
  await expect
    .poll(async () => count(await diagnostics(app), "external_open_refused"))
    .toBe(before + 1);

  expect(page.url()).toMatch(/^app:\/\/tinydocy\//);
  expect(count(await diagnostics(app), "external_open")).toBe(0);
});

test("the top frame's links reach the browser, a few per window at most", async () => {
  current = await launch();
  const { app } = current;
  const page = await firstPage(app);
  const denied = await page.evaluate(() => {
    let nulls = 0;
    for (let i = 0; i < 6; i++)
      if (window.open(`https://example.com/${i}`) === null) nulls++;
    return nulls;
  });
  expect(denied).toBe(6); // no window ever opens in-app
  await expect
    .poll(async () => count(await diagnostics(app), "external_open"))
    .toBe(3);
  const events = await diagnostics(app);
  // One report for the burst, however many were refused.
  expect(
    events.filter(
      (e) => e.event === "external_open_refused" && e.reason === "rate",
    ),
  ).toHaveLength(1);
});

test("downloads are refused", async () => {
  current = await launch();
  const { app } = current;
  const page = await firstPage(app);
  await page.evaluate(() => {
    const link = document.createElement("a");
    link.href = "/icon";
    link.download = "icon.png";
    document.body.append(link);
    link.click();
    link.remove();
  });
  await waitForEvent(app, "download_refused");
});

test("non-HTML responses carry a CSP too", async () => {
  current = await launch();
  const page = await firstPage(current.app);
  const headers = await page.evaluate(async () => {
    const script = document.querySelector<HTMLScriptElement>("script[src]");
    const css = document.querySelector<HTMLLinkElement>(
      'link[rel="stylesheet"]',
    );
    const paths = [
      script ? new URL(script.src).pathname : null,
      css ? new URL(css.href).pathname : null,
      "/icon",
      "/no-such-file.js",
    ].filter((p): p is string => p !== null);
    return Promise.all(
      paths.map(async (path) => {
        const response = await fetch(path);
        return {
          path,
          status: response.status,
          csp: response.headers.get("content-security-policy") ?? "",
        };
      }),
    );
  });
  expect(headers.length).toBeGreaterThanOrEqual(3);
  for (const { csp } of headers) {
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("unsafe");
  }
  expect(headers.at(-1)?.status).toBe(404);
});
