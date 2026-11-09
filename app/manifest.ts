import type { MetadataRoute } from "next";

import { pwaManifestIcon } from "@/lib/pwa-icons";
import {
  APP_DESCRIPTION,
  BACKGROUND_COLOR,
  SITE_NAME,
  THEME_COLOR,
} from "@/lib/site-config";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // Install identity: never change, or existing installs are orphaned.
    id: "/",
    name: SITE_NAME,
    short_name: SITE_NAME,
    description: APP_DESCRIPTION,
    lang: "en",
    dir: "ltr",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    categories: ["productivity", "utilities"],
    prefer_related_applications: false,
    icons: (["any-192", "any-512", "maskable-512"] as const).map(
      pwaManifestIcon,
    ),
  };
}
