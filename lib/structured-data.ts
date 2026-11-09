import {
  PARENT_ORG,
  REPO_URL,
  SITE_ANSWER,
  SITE_FEATURES,
  SITE_NAME,
  SITE_URL,
} from "@/lib/site-config";

const ORG_ID = `${PARENT_ORG.url}/#organization`;
const APP_ID = `${SITE_URL}/#app`;

/**
 * schema.org graph for the public pages. Mirrors the visible copy in
 * lib/site-config.ts; no ratings or reviews (Google spam policy).
 */
export function buildSiteJsonLd() {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORG_ID,
        name: PARENT_ORG.name,
        url: PARENT_ORG.url,
        sameAs: [PARENT_ORG.github, PARENT_ORG.repo],
      },
      {
        "@type": "WebSite",
        "@id": `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        inLanguage: "en",
        publisher: { "@id": ORG_ID },
      },
      {
        "@type": "WebApplication",
        "@id": APP_ID,
        name: SITE_NAME,
        url: `${SITE_URL}/`,
        description: SITE_ANSWER,
        applicationCategory: "BusinessApplication",
        applicationSubCategory: "Collaborative document editor",
        operatingSystem: "Any (web browser)",
        browserRequirements: "Requires JavaScript and WebSocket support",
        isAccessibleForFree: true,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
        featureList: [...SITE_FEATURES],
        license: "https://opensource.org/licenses/MIT",
        image: `${SITE_URL}/opengraph-image`,
        sameAs: [REPO_URL],
        publisher: { "@id": ORG_ID },
      },
      {
        "@type": "SoftwareSourceCode",
        "@id": `${REPO_URL}#code`,
        name: `${SITE_NAME} source code`,
        codeRepository: REPO_URL,
        programmingLanguage: "TypeScript",
        runtimePlatform: "Bun",
        license: "https://opensource.org/licenses/MIT",
        targetProduct: { "@id": APP_ID },
        author: { "@id": ORG_ID },
      },
    ],
  };
}

/** Escapes `<` so the JSON can never close the surrounding script tag. */
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
