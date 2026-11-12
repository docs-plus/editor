# Analytics Runbook (Google Analytics 4)

TinyDocy ships an optional, opt-in GA4 integration. This page covers how to
turn it on, what it sends, and the GA property settings the code cannot
enforce on its own.

## What the code guarantees

- **Off by default.** The tag exists only in production builds made with a
  valid `NEXT_PUBLIC_GA_MEASUREMENT_ID` (`G-` followed by 4–20 uppercase
  letters or digits). `next dev`, unit tests, unset or malformed IDs ship no tag,
  and the CSP has no Google hosts.
- **Opt-in.** Nothing is requested from Google before the visitor clicks
  Allow in the consent banner (bottom left). Decline and Allow look the same.
  The choice is stored in `localStorage` (`tinydocy-analytics-consent`) and can
  be changed on `/privacy`; withdrawing sets `ga-disable-<id>` and deletes the
  `_ga` / `_ga_*` cookies without a reload.
- **Never asked, never loaded** when the browser sends Global Privacy Control
  or Do Not Track, or when `navigator.webdriver` is true (Playwright, Puppeteer,
  Selenium).
- **Consent Mode v2:** `ad_storage`, `ad_user_data` and `ad_personalization`
  are always denied; Google signals and ad personalization are off; the cookie
  is scoped to the current host (not `.docs.plus`) and capped at 13 months.
- **No document content.** `page_location` is origin + path only (the
  `?filter=` query holds heading text), `page_title` is always `TinyDocy`, and
  events carry only enums and small counts (`lib/analytics.ts`,
  `AnalyticsEventMap`).

## Turning it on

1. Publish the controller and contact first: set
   `NEXT_PUBLIC_PRIVACY_CONTROLLER` and `NEXT_PUBLIC_PRIVACY_EMAIL`.
2. Add `NEXT_PUBLIC_GA_MEASUREMENT_ID=G-XXXXXXXXXX` to `.env.production`.
3. Rebuild and restart: `bun run build`, then `bunx pm2 restart editor-next`.
   The ID is inlined into the client bundle and the CSP header at build time,
   so setting it in `ecosystem.config.cjs` does nothing.
4. Check: `curl -sI https://<host>/ | grep -i content-security-policy` lists
   `https://www.googletagmanager.com`, and a fresh browser profile shows the
   consent banner.

To turn it off, remove the variable and rebuild.

## Required GA property settings

Code alone cannot disable GA4's automatic collection. In GA Admin:

1. **Data streams → Web → Enhanced measurement:** keep *Page views*, but under
   its advanced settings turn OFF *Page changes based on browser history
   events* (the heading filter rewrites the URL). Turn OFF *Site search*,
   *Outbound clicks*, *Video engagement*, *File downloads* and *Form
   interactions*: they would send link URLs and video titles from documents.
2. **Data streams → Web → Redact data:** redact the URL query parameters
   `filter` and `mode` as a second layer.
3. **Data collection:** Google signals OFF; granular location and device data
   OFF for all regions; user-provided data collection OFF.
4. **Data retention:** 2 months.
5. **Account settings:** accept the Data Processing Terms.
6. Never link Google Ads.

## Events

| Event | Parameters | Fired from |
| --- | --- | --- |
| `page_view` | `page_location` (origin + path) | `components/analytics/google-analytics.tsx` |
| `editor_ready` | — | `components/editor-app/editor-app.tsx` |
| `tab_create` | `tab_count` | `hooks/use-synced-tabs.ts` |
| `tab_close_all` | `closed_count` | `hooks/use-synced-tabs.ts` |
| `playground_regenerate` | — | `components/editor-app/editor-app.tsx` |
| `diagram_insert` | — | `components/tiptap-ui/mermaid-button/mermaid-button.tsx` |
| `media_embed` | `provider` (e.g. `youtube`, never the URL) | `components/tiptap-ui/media-embed-popover/use-media-embed.ts` |
| `collab_peers` | `peers_bucket` (`1`, `2`, `3-5`, `6-10`, `11+`; peak per document view) | `components/tiptap-ui/user-identity-button.tsx` |
| `outbound_click` | `target` (`github`, `discord`) | `components/tiptap-ui/user-identity-button.tsx` |
| `pwa_install` | `outcome` (`accepted`, `dismissed`) | `components/pwa/install-app-button.tsx` |
| `schema_repair_failed` | — | `lib/schema-guard.ts` |

Register `provider` and `peers_bucket` as event-scoped custom dimensions, and
`tab_count` and `closed_count` as custom metrics.

To add an event, extend `AnalyticsEventMap` with enum or count values only.
Never send document text, titles, tab IDs, URLs or user names.
