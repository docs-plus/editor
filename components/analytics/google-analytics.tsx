"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import Script from "next/script";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ANALYTICS_CONSENT_EVENT,
  hasPrivacySignal,
  initGtag,
  isAutomatedBrowser,
  readConsent,
  revokeGtag,
  saveConsent,
  trackPageView,
} from "@/lib/analytics";
import { GA_MEASUREMENT_ID } from "@/lib/analytics-config";

type TagState = "idle" | "ask" | "loaded";

function resolveTagState(): TagState {
  if (!GA_MEASUREMENT_ID) return "idle";
  if (isAutomatedBrowser(navigator) || hasPrivacySignal(navigator)) {
    return "idle";
  }
  const consent = readConsent();
  if (consent === "granted") return "loaded";
  return consent === "denied" ? "idle" : "ask";
}

/**
 * Opt-in GA4. Renders nothing on the server, nothing without
 * NEXT_PUBLIC_GA_MEASUREMENT_ID, and never requests gtag.js before Allow.
 */
export function GoogleAnalytics() {
  const [state, setState] = useState<TagState>("idle");
  const pathname = usePathname();

  useEffect(() => {
    if (!GA_MEASUREMENT_ID) return;
    const id = GA_MEASUREMENT_ID;
    const sync = () => {
      const next = resolveTagState();
      if (next === "loaded") initGtag(id);
      else revokeGtag(id);
      setState(next);
    };
    sync();
    window.addEventListener(ANALYTICS_CONSENT_EVENT, sync);
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, sync);
  }, []);

  useEffect(() => {
    if (state === "loaded") trackPageView(pathname);
  }, [pathname, state]);

  if (!GA_MEASUREMENT_ID || state === "idle") return null;

  if (state === "loaded") {
    return (
      <Script
        id="ga-gtag"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`}
        strategy="lazyOnload"
      />
    );
  }

  return (
    <section
      aria-label="Analytics consent"
      className="fixed bottom-4 left-4 z-50 max-w-sm rounded-md border bg-background p-3 text-xs shadow-md"
      data-nosnippet
    >
      <p className="text-muted-foreground">
        Can we count visits and feature use with Google Analytics? It never sees
        what you write. Google sets a cookie for up to 13 months.{" "}
        <Link href="/privacy" className="underline underline-offset-2">
          Privacy
        </Link>
      </p>
      <div className="mt-2 flex justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() => saveConsent("denied")}
        >
          Decline
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => saveConsent("granted")}
        >
          Allow
        </Button>
      </div>
    </section>
  );
}
