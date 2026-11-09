"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  ANALYTICS_CONSENT_EVENT,
  type AnalyticsConsent,
  readConsent,
  saveConsent,
} from "@/lib/analytics";
import { GA_MEASUREMENT_ID } from "@/lib/analytics-config";

/** Lets visitors grant or withdraw analytics consent from /privacy. */
export function AnalyticsChoice() {
  const [ready, setReady] = useState(false);
  const [consent, setConsent] = useState<AnalyticsConsent | null>(null);

  useEffect(() => {
    const sync = () => setConsent(readConsent());
    sync();
    setReady(true);
    window.addEventListener(ANALYTICS_CONSENT_EVENT, sync);
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, sync);
  }, []);

  if (!GA_MEASUREMENT_ID) {
    return <p>Analytics is not enabled on this deployment.</p>;
  }
  if (!ready) return null;

  const granted = consent === "granted";
  return (
    <div className="flex flex-wrap items-center gap-3">
      <p>Google Analytics is {granted ? "on" : "off"} for this browser.</p>
      <Button
        size="sm"
        variant="outline"
        onClick={() => saveConsent(granted ? "denied" : "granted")}
      >
        {granted ? "Turn off" : "Turn on"}
      </Button>
    </div>
  );
}
