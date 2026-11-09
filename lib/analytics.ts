import type { MediaNodeType } from "@docs.plus/extension-hypermultimedia";

import { GA_MEASUREMENT_ID } from "@/lib/analytics-config";

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    [key: `ga-disable-${string}`]: boolean | undefined;
  }
}

const CONSENT_KEY = "tinydocy-analytics-consent";
export const ANALYTICS_CONSENT_EVENT = "tinydocy:analytics-consent";
/** CNIL caps audience-measurement cookies at 13 months. */
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 395;
const PAGE_TITLE = "TinyDocy";

export const PEERS_BUCKETS = ["1", "2", "3-5", "6-10", "11+"] as const;
export type PeersBucket = (typeof PEERS_BUCKETS)[number];
export type AnalyticsConsent = "granted" | "denied";

/**
 * Every event GA may receive. Values are enums or small counts by
 * construction: never document text, titles, tab IDs, URLs or user names.
 */
export interface AnalyticsEventMap {
  editor_ready: Record<string, never>;
  tab_create: { tab_count: number };
  tab_close_all: { closed_count: number };
  playground_regenerate: Record<string, never>;
  diagram_insert: Record<string, never>;
  media_embed: { provider: MediaNodeType };
  collab_peers: { peers_bucket: PeersBucket };
  outbound_click: { target: "github" | "discord" };
}

type PrivacyAwareNavigator = Navigator & { globalPrivacyControl?: boolean };

export function hasPrivacySignal(nav: PrivacyAwareNavigator): boolean {
  return nav.globalPrivacyControl === true || nav.doNotTrack === "1";
}

/** Playwright, Puppeteer and Selenium set `navigator.webdriver`. */
export function isAutomatedBrowser(nav: Navigator): boolean {
  return nav.webdriver === true;
}

export function readConsent(): AnalyticsConsent | null {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function saveConsent(consent: AnalyticsConsent): void {
  try {
    localStorage.setItem(CONSENT_KEY, consent);
  } catch {
    // Private mode: the choice lasts for this page only.
  }
  window.dispatchEvent(new Event(ANALYTICS_CONSENT_EVENT));
}

export function bucketPeers(count: number): PeersBucket {
  if (count <= 1) return "1";
  if (count === 2) return "2";
  if (count <= 5) return "3-5";
  if (count <= 10) return "6-10";
  return "11+";
}

/** Origin + path only: `?filter=` carries heading slugs, i.e. document text. */
function pageLocation(pathname = window.location.pathname): string {
  return `${window.location.origin}${pathname}`;
}

/**
 * Queues the gtag bootstrap. Called only after opt-in, so analytics storage
 * is granted; ad signals stay denied (Consent Mode v2).
 */
export function initGtag(measurementId: string): void {
  window[`ga-disable-${measurementId}`] = false;
  if (window.gtag) {
    window.gtag("consent", "update", { analytics_storage: "granted" });
    return;
  }
  window.dataLayer = window.dataLayer ?? [];
  const gtag = function gtag() {
    // biome-ignore lint/complexity/noArguments: gtag.js only reads Arguments objects
    window.dataLayer?.push(arguments);
  } as (...args: unknown[]) => void;
  window.gtag = gtag;

  gtag("consent", "default", {
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
    analytics_storage: "granted",
  });
  gtag("set", "ads_data_redaction", true);
  gtag("set", { page_location: pageLocation(), page_title: PAGE_TITLE });
  gtag("js", new Date());
  gtag("config", measurementId, {
    send_page_view: false, // trackPageView sends a sanitized one
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    // Default "auto" writes _ga on .docs.plus, shared with docs.plus and
    // sent on every ws.tiny.docs.plus upgrade. Scope it to this host.
    cookie_domain: window.location.hostname,
    cookie_expires: COOKIE_MAX_AGE_SECONDS,
    ...(window.location.protocol === "https:"
      ? { cookie_flags: "SameSite=Lax;Secure" }
      : {}),
  });
}

/** Withdraws consent at runtime and deletes `_ga` / `_ga_<id>` cookies. */
export function revokeGtag(measurementId: string): void {
  window[`ga-disable-${measurementId}`] = true;
  window.gtag?.("consent", "update", { analytics_storage: "denied" });
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim() ?? "";
    if (name !== "_ga" && !name.startsWith("_ga_")) continue;
    for (const domain of [`; Domain=${window.location.hostname}`, ""]) {
      // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API is not in every supported browser
      document.cookie = `${name}=; Max-Age=0; Path=/${domain}`;
    }
  }
}

export function trackPageView(pathname: string): void {
  if (!GA_MEASUREMENT_ID || typeof window === "undefined") return;
  const page_location = pageLocation(pathname);
  window.gtag?.("set", { page_location, page_title: PAGE_TITLE });
  window.gtag?.("event", "page_view", { page_location });
}

/** No-op without GA, before consent, or on the server. */
export function trackEvent<K extends keyof AnalyticsEventMap>(
  name: K,
  params: AnalyticsEventMap[K],
): void {
  if (!GA_MEASUREMENT_ID || typeof window === "undefined") return;
  window.gtag?.("event", name, params);
}
