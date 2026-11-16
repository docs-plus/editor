import type { Metadata } from "next";

import { RetryButton } from "@/components/pwa";
import { SitePage } from "@/components/site-page";
import { SITE_NAME } from "@/lib/site-config";

/**
 * Static fallback the service worker precaches at install and serves for
 * pages it has no stored copy of. Kept out of app/sitemap.ts.
 */
export const metadata: Metadata = {
  title: "Offline",
  robots: { index: false, follow: false },
};

export default function OfflinePage() {
  return (
    <SitePage>
      <article>
        <h1>You&apos;re offline</h1>
        <p>
          {SITE_NAME} needs a connection to open shared documents. Reconnect and
          try again.
        </p>
        <RetryButton />
      </article>
    </SitePage>
  );
}
