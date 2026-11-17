import Link from "next/link";

import { SITE_URL } from "@/lib/site-config";

/**
 * The privacy policy link. `/privacy` is a web page only, so desktop builds
 * (`NEXT_PUBLIC_APP_TARGET=desktop`) link to the website's copy instead: a
 * new window, which the desktop shell opens in the system browser. A plain
 * anchor is never prefetched, so the app never asks its own origin for
 * `/privacy`. The comparison folds at build time.
 */
export function PrivacyLink({ className }: { className?: string }) {
  if (process.env.NEXT_PUBLIC_APP_TARGET === "desktop") {
    return (
      <a
        href={`${SITE_URL}/privacy`}
        target="_blank"
        rel="noopener noreferrer"
        className={className}
      >
        Privacy
      </a>
    );
  }
  return (
    <Link href="/privacy" className={className}>
      Privacy
    </Link>
  );
}
