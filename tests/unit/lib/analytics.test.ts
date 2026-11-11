import { afterEach, describe, expect, it, mock, vi } from "bun:test";

import * as analyticsConfig from "@/lib/analytics-config";

const { parseMeasurementId, resolveMeasurementId } = analyticsConfig;

mock.module("@/lib/analytics-config", () => ({
  ...analyticsConfig,
  GA_MEASUREMENT_ID: "G-TEST1234",
}));
// Loaded after the mock: static imports are hoisted above `mock.module`.
const {
  bucketPeers,
  hasPrivacySignal,
  initGtag,
  isAutomatedBrowser,
  readConsent,
  revokeGtag,
  saveConsent,
  trackEvent,
  trackPageView,
} = await import("@/lib/analytics");

type TestNavigator = Partial<Navigator & { globalPrivacyControl: boolean }>;
const fakeNavigator = (fields: TestNavigator) => fields as Navigator;
const queuedCommands = () =>
  (window.dataLayer ?? []).map((entry) => Array.from(entry as IArguments));

afterEach(() => {
  delete window.dataLayer;
  delete window.gtag;
  delete window["ga-disable-G-TEST1234"];
  localStorage.clear();
  history.replaceState(null, "", "/");
});

describe("analytics config", () => {
  it("accepts only GA4 measurement IDs", () => {
    expect(parseMeasurementId(" G-AB12CD34EF ")).toBe("G-AB12CD34EF");
    for (const bad of [
      undefined,
      "",
      "UA-1234-1",
      "G-",
      "g-ab12cd",
      "G-AB');alert(1)//",
      "G-AB12CD34EF&foo=bar",
    ]) {
      expect(parseMeasurementId(bad)).toBeNull();
    }
  });

  it("is off outside production builds", () => {
    expect(resolveMeasurementId("G-AB12CD34EF", "development")).toBeNull();
    expect(resolveMeasurementId("G-AB12CD34EF", "test")).toBeNull();
    expect(resolveMeasurementId("G-AB12CD34EF", "production")).toBe(
      "G-AB12CD34EF",
    );
    expect(resolveMeasurementId(undefined, "production")).toBeNull();
  });
});

describe("gtag bootstrap", () => {
  it("trackEvent is a no-op before consent loads gtag", () => {
    trackEvent("diagram_insert", {});
    trackPageView("/");
    expect(window.dataLayer).toBeUndefined();
  });

  it("queues ad-denied consent defaults first and strips the query", () => {
    history.replaceState(null, "", "/?filter=secret-heading&mode=and");
    initGtag("G-TEST1234");
    trackPageView("/");
    trackEvent("media_embed", { provider: "youtube" });

    const commands = queuedCommands();
    expect(commands[0]).toEqual([
      "consent",
      "default",
      expect.objectContaining({
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "granted",
      }),
    ]);
    const config = commands.find((c) => c[0] === "config");
    expect(config?.[2]).toMatchObject({
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      cookie_domain: window.location.hostname,
    });
    expect(JSON.stringify(commands)).not.toContain("secret-heading");
    expect(commands).toContainEqual([
      "event",
      "page_view",
      { page_location: `${window.location.origin}/` },
    ]);
    expect(commands.at(-1)).toEqual([
      "event",
      "media_embed",
      { provider: "youtube" },
    ]);
  });

  it("revoke disables the tag, denies storage and clears GA cookies", () => {
    initGtag("G-TEST1234");
    // biome-ignore lint/suspicious/noDocumentCookie: test fixture
    document.cookie = "_ga=GA1.1.123; Path=/";
    // biome-ignore lint/suspicious/noDocumentCookie: test fixture
    document.cookie = "_ga_TEST1234=GS1.1.123; Path=/";
    // biome-ignore lint/suspicious/noDocumentCookie: test fixture
    document.cookie = "keep=1; Path=/";
    revokeGtag("G-TEST1234");

    expect(window["ga-disable-G-TEST1234"]).toBe(true);
    expect(queuedCommands().at(-1)).toEqual([
      "consent",
      "update",
      { analytics_storage: "denied" },
    ]);
    // Absent or empty: happy-dom keeps an emptied cookie after `Max-Age=0`.
    expect(document.cookie).not.toMatch(/(^|; )_ga(_\w+)?=[^;]/);
    expect(document.cookie).toContain("keep=1");
  });

  it("re-granting after revoke updates consent instead of re-bootstrapping", () => {
    initGtag("G-TEST1234");
    revokeGtag("G-TEST1234");
    initGtag("G-TEST1234");
    expect(window["ga-disable-G-TEST1234"]).toBe(false);
    expect(queuedCommands().filter((c) => c[0] === "config")).toHaveLength(1);
    expect(queuedCommands().at(-1)).toEqual([
      "consent",
      "update",
      { analytics_storage: "granted" },
    ]);
  });
});

describe("privacy signals and consent", () => {
  it("honours GPC and DNT, and detects automation", () => {
    expect(
      hasPrivacySignal(fakeNavigator({ globalPrivacyControl: true })),
    ).toBe(true);
    expect(hasPrivacySignal(fakeNavigator({ doNotTrack: "1" }))).toBe(true);
    expect(hasPrivacySignal(fakeNavigator({ doNotTrack: null }))).toBe(false);
    expect(isAutomatedBrowser(fakeNavigator({ webdriver: true }))).toBe(true);
    expect(isAutomatedBrowser(fakeNavigator({ webdriver: false }))).toBe(false);
  });

  it("round-trips consent, notifies listeners and ignores junk", () => {
    const listener = vi.fn();
    window.addEventListener("tinydocy:analytics-consent", listener);
    expect(readConsent()).toBeNull();
    saveConsent("granted");
    expect(readConsent()).toBe("granted");
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener("tinydocy:analytics-consent", listener);

    localStorage.setItem("tinydocy-analytics-consent", "yes");
    expect(readConsent()).toBeNull();
  });

  it("buckets peer counts", () => {
    expect([0, 1, 2, 4, 5, 6, 10, 11, 40].map(bucketPeers)).toEqual([
      "1",
      "1",
      "2",
      "3-5",
      "3-5",
      "6-10",
      "6-10",
      "11+",
      "11+",
    ]);
  });
});
