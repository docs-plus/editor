import { buildSiteJsonLd, serializeJsonLd } from "@/lib/structured-data";

/**
 * JSON-LD data block. Not executed by the browser, so script-src does not
 * apply; `<` is escaped by serializeJsonLd.
 */
export function SiteJsonLd() {
  return (
    <script
      type="application/ld+json"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: static JSON-LD built from constants, `<` escaped
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildSiteJsonLd()) }}
    />
  );
}
