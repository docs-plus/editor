# TinyDocy: name, app icon, visual identity and website

> **Owner answers (plan v8, 2026-11-16)**, which override the open questions and calls below:
> - **D33 (Q1):** **keep "TinyDocy"**, styled "TinyDocy, by docs.plus". The owner commissions a trademark search now (Tiny®/TinyMCE® and the "Tiny Doc" app, §1.2). **Target: P2.5. Hard stop: the first signed Gate 3 build**, which locks the `appId`, the `userData` folder, the backups folder, the `tinydocy://` scheme, the UTI and MIME type, the Linux WM class and the signer name. **Frozen whatever the name:** `tinydocy:` links inside documents, HKDF labels, IndexedDB and Web Lock names, and the file magic.
> - **D34 (Q2):** icon direction **A, "Title page"**.
> - **D35 (Q3):** builds are **signed as an organisation**. D-U-N-S and entity verification can take weeks, so enrolment is a week-0 owner action bundled with D33.
> - **D41:** B8's launch video and B6's Atom/RSS feed are the first two items on the plan's cut-first list, ahead of D30.
> - **Staff and HoE review (v8), applied below:** the grey sandbox icons and the "TinyDocy Sandbox" name are tied to the library launch flag `NEXT_PUBLIC_LIBRARY` (Gate 5), not to the W5 merge, with a CHANGELOG entry, a design review and a Deploy note that iOS Home Screen icons won't update (§2.3). B1 changes icons before Gate 2, so the plan's Gate 3 "classic look, pixel for pixel" clause excludes icons. `/privacy` ships in three parts: the summary and `#desktop` at Gate 3, `#shared-documents` and `/terms` at Gate 4, `#my-documents` at Gate 5; the privacy controller and contact (`PRIVACY_CONTACT`) are owner work before Gate 3 (§4.5). OB4 is re-estimated from 2 to 3 days. B1–B9 total **12.5** agent-days (not 11.5). The S3 spike gains about 1 day (§6).

- **Status:** Draft v1, 2026-11-16, amended by plan v8 (D33–D35, D41). Planning only. Nothing here is built yet. The only file this design adds is this one.
- **Lens:** brand and visual design, product marketing, web engineering.
- **Builds on:**
  - [Plan v7](2026-11-15-desktop-local-first-design.md): D0 (private local documents), D6 (one combined v1), D11 (the library on its own origin), D31 (feedback alias), D32 (build ladder), §6 legal and trust, §8.3 owner actions, §12 costs
  - [Test and release strategy](2026-11-16-test-release-strategy.md): §5.4 release notes and What's New, §5.5 halt, §5.8 download page, README and announcement, Q16
  - [Onboarding, templates and import](2026-11-16-onboarding-templates-import-design.md): §1.1 first-run copy, §1.5 What's New, §1.6 the web path, OB3 (= Q14), OB4 (= Q16)
  - [Web library](2026-11-16-web-library-design.md): W-D6 naming, W-D8 origin and CSP, §5.4 no analytics on the library
  - [Preferences](2026-11-16-preferences-design.md): §5.11 `--primary-ink` (F1), font presets (C6)
  - [Desktop UX](2026-11-15-desktop-ux-design.md) §9: copy guidelines and vocabulary
  - [Desktop prototype](../../design/2026-11-15-desktop-prototype.html)
  - Code read on 2026-11-16: `lib/site-config.ts`, `lib/structured-data.ts`, `components/brand/brand-mark.tsx`, `app/icon.tsx`, `app/apple-icon.tsx`, `app/opengraph-image.tsx`, `app/manifest.ts`, `lib/pwa-icons.ts`, `app/pwa-icons/[id]/route.tsx`, `app/favicon.ico`, `app/globals.css`, `app/layout.tsx`, `app/privacy/page.tsx`, `app/about/page.tsx`, `components/site-page/site-page.tsx`, README
- **What this decides.** The product name and its relation to docs.plus, the app icon on every platform and its build pipeline, the visual identity, the public web pages for the desktop release, and the assets each gate needs.
- **What it does not decide.** Anything legal. Trademark, privacy-law and terms questions are flagged for the owner and counsel; the plan's rule holds: "The plan provides the mechanisms. It doesn't assert legal duties."

---

## 0. Summary

| # | Decision | Recommendation |
|---|---|---|
| 1 | Name | **Keep "TinyDocy"**, written "TinyDocy, by docs.plus" where a descriptor fits. Run a trademark clearance search, because the name is about to be frozen into the app id, data paths, the backup folder, the URL scheme and the file type (§1.4). *(D33: target P2.5; hard stop the first signed Gate 3 build.)* The one flag worth counsel's time: **tiny.cloud states that Tiny® and TinyMCE® are registered trademarks of Tiny Technologies, Inc.**, a rich-text editor company (§1.2). A "Tiny Doc" PDF-scanner app on the App Store is the closest store name. **Answered by D33.** |
| 2 | App icon | **Concept A, "Title page":** a portrait A-ratio page with a heavy amber title bar and two body lines. It draws the product's one structural idea (every document starts with a title) without letters. It replaces today's font-rendered "T". **Answered by D34.** |
| 3 | Construction | **One SVG geometry module** feeds the web icons (`BrandMark`, Satori), the desktop rasters and the Icon Composer layers. **Plated** where the OS draws a shape (macOS, iOS, PWA maskable); **unplated** where it shows free-form icons (Windows, Linux, browser tabs). A drift test keeps committed binaries equal to the master. |
| 4 | Surfaces | **Amber = private surfaces** (desktop app, My documents). **Neutral plate = the public sandbox** (favicon, PWA), switched on with the library launch flag `NEXT_PUBLIC_LIBRARY` at Gate 5, when the first private surface exists (v8). Someone with both installed can tell them apart at 32 px. The library gets its own icons through its layout and a host-aware manifest (W4), because root icon files can't vary by host. |
| 5 | Identity | Amber stays (Tailwind v4 amber 50–800, today's tokens). Inter for the interface and the wordmark, Arial stays the document default. No custom lettering, no illustrations: real screenshots of the teaching Playground. Voice follows UX §9. |
| 6 | Website | **No separate marketing site.** tiny.docs.plus keeps the sandbox at `/` and gains `/download` (product page and downloads, OB4), `/releases` (desktop release notes) and `/terms`, plus a rewritten `/privacy`. my.tiny.docs.plus stays app-only, `noindex`, no analytics. Binaries live on the feed host. |
| 7 | Download page | Server-rendered list of every build, enhanced (never gated) by OS detection. Apple Silicon is the default on Mac, Intel always one click away. SHA-256 sums, signing identity, SmartScreen and Linux notes, tested system requirements, and "what stays on your computer". Fed by a build-time JSON written from the release job. |
| 8 | Gates | **Gate 3** (signed builds to 10 testers) needs: the final icon set, the `.tinydoc` icon, DMG art, the tester email with checksums, install help, and the **summary and `#desktop` section of `/privacy`**. **Gate 4** needs `/terms` and the `#shared-documents` section of `/privacy`. **Gate 5** needs `#my-documents`, `/download`, `/releases`, screenshots, the demo video, JSON-LD and the announcement. |
| 9 | PRs | **B1–B9**, about 12.5 agent-days (v8; the itemised list always summed to 12.5) plus about 2 owner-days, mostly inside existing PR slots (P2.5, P3.1, P3.4, OB4). §6. |

---

## 1. Name

### 1.1 What exists today

- `SITE_NAME = "TinyDocy"` in `lib/site-config.ts` is used by metadata, the manifest (`name`, `short_name`), the OG image, `/about`, `/llms.txt` and JSON-LD.
- The repository is `docs-plus/editor`. Storage keys are `tinydocy-*` (`tinydocy-user`, `tinydocy-ui`, `tinydocy-continue`).
- The plan already commits to `~/TinyDocy Backups`, the `tinydocy://` scheme and the `.tinydoc` extension (plan §5.2, §5.3, P2.5).
- docs.plus writes its own name in lower case ("docs.plus") with the tagline "Get everyone on the same page" ([docs.plus](https://docs.plus)). It is a collaborative product with a chatroom per heading. TinyDocy's v1 promise (D0) is the opposite end: private documents on one computer, shared occasionally.

### 1.2 Collision checks (2026-11-16)

These are searches, not legal conclusions. The owner and counsel decide what they mean.

| Check | Result | Weight |
|---|---|---|
| **"Tiny" in the editor market** | The tiny.cloud footer states that TinyMCE® and Tiny® are registered trademarks of Tiny Technologies, Inc., maker of the TinyMCE rich-text editor, now part of Tiugo Technologies alongside CKSource ([tiny.cloud attribution](https://tiny.cloud/legal/attribution-requirements), [Tiugo acquisition](https://tiny.cloud/news/tiugo-technologies-acquires-tinymce)). Same field (editing software). | **Highest. For counsel.** Whether a compound like "TinyDocy" conflicts is a legal question this document doesn't answer. |
| "Docy" / "Docsy" | DOCY, a document-scanner app on the App Store ([App Store](https://apps.apple.com/us/app/docy-scan-document-pdf-via-cam/id6741674128)); Docy, a WordPress documentation theme ([spider-themes](https://wordpress-theme.spider-themes.net/docy/blog/docs/sample-user-guide/doc-section)); Docsy, a well-known Hugo documentation theme (sound-alike). | Low to medium: different products, but the suffix is crowded. |
| "Tiny Docs", "tinyDOC" | A "Tiny Docs" writing web app on Product Hunt ([Product Hunt](https://www.producthunt.com/products/tiny-docs)); tinyDOC, a small WYSIWYG editor on GitHub ([lrusso/tinyDOC2](https://github.com/lrusso/tinyDOC2)); several small `tinydocs` repositories. | Low: not "TinyDocy", but close enough to confuse search. |
| Exact "TinyDocy" on the web | Only this project. Two duckdns.org sites mirror this repository's README. | **A risk once there is a download page:** a mirror could host fake installers (§4.2, "official downloads" line). |
| App stores | **Apple App Store:** no "TinyDocy". Nearest: **"Tiny Doc: PDF Scanner App"** by TinyWork Apps ([App Store](https://apps.apple.com/us/app/tiny-doc-a-pdf-scanner-app/id556500145)), plus TinyDo (tasks) and Tinydot (websites). **Microsoft Store:** nothing found by web search on apps.microsoft.com. **Flathub** (search API): no match. **Snap Store** (find API): no results. | "Tiny Doc" is one letter from the name and identical to the `.tinydoc` extension, but a different category (scanning). Mention to counsel with the Tiny® item. |
| Domains | `tinydocy.com`: whois "No match" (unregistered). `tinydocy.org`: "Domain not found". `tinydocy.app`: RDAP 404 at the registry (not registered). | Owner action: register `tinydocy.com` defensively and redirect it to `/download` (about $10–20 a year); `.app` optional. |
| npm | `tinydocy`: 404 (free). | Reserve it only if a package is planned; not needed. |
| GitHub | `gh search repos tinydocy`: no repository by that name. | Fine. |
| **Not checked** | USPTO, EUIPO and WIPO Global Brand Database (classes 9 and 42: "TINYDOCY", "TINY DOC", "TINY"). | Owner and counsel. |

### 1.3 Pronunciation and how it reads

- "TinyDocy" has two plausible readings: "tiny-**dock**-ee" and "tiny-**doss**-ee" (after Docsy). Recommend **"tiny-docky"**, said once in the `/about` FAQ ("How do you say TinyDocy?") and in the press kit.
- Written form: always **TinyDocy** (capital T and D, no space). Never "Tinydocy", "Tiny Docy" or "TD".
- The file extension `.tinydoc` doesn't need to match the name exactly; it reads as "a tiny doc" and is already planned.

### 1.4 Why the deadline is Gate 2, not Gate 5

> **Superseded in part by D33 (plan v8).** The deadline is now **target P2.5, hard stop the first signed Gate 3 build**: Gate 2 builds go to three people unsigned (D32), so a rename before Gate 3 costs a migration for them only. The first signed Gate 3 build locks the `appId`, the `userData` folder, the backups folder, the `tinydocy://` scheme, the UTI and MIME type, the Linux WM class and the signer name. These are **frozen whatever the name**, already: `tinydocy:` links inside documents, HKDF labels, IndexedDB and Web Lock names, and the file magic. The table below still lists what a rename costs.

The name becomes an **install identity** at the first Gate 2 build, exactly like the frozen manifest `id`:

| Where the name is frozen | Cost of a later rename |
|---|---|
| electron-builder `appId` (proposed `plus.docs.tinydocy`) and `productName` | macOS and Windows treat a new `appId` as a different app; electron-updater can't update across it. |
| The `userData` folder (from `productName`) | Every tester's library must be migrated. |
| `~/TinyDocy Backups` | The backup folder moves; the restore sheet looks for the old one. |
| `tinydocy://` scheme, `.tinydoc` UTI and MIME type | Old links and file associations break. |
| Signing identity display name, update feed paths | New certificates or paths. |

So: **decide the name before P2.5 builds the first internal installer.** If counsel advises a change, rename then (one PR across `site-config.ts`, storage-key migration and the desktop constants). After Gate 2 a rename costs a migration release; after Gate 5 it costs the public install base.

### 1.5 Relationship to docs.plus

| Option | Reads as | Verdict |
|---|---|---|
| **"TinyDocy, by docs.plus"** | An endorsed product made by the docs.plus team | **Recommended.** Says who stands behind the downloads and the share server without promising docs.plus features. |
| "TinyDocy, a docs.plus lab" | An experiment that may go away | **No.** D0 asks people to trust it with their documents; a "lab" undercuts durability and the stable 1.0 promise. |
| "docs.plus Desktop" / rename into docs.plus | The desktop client of docs.plus | **No.** docs.plus is a group product with chatrooms; v1 is a private local editor. Users would expect accounts and sync that don't exist. |

- **Where each phrase appears:** "by docs.plus" in the lockup on `/download`, the OG image, the About pane and the press kit. "The public testbed for docs.plus" stays only on the sandbox surfaces (`SITE_ANSWER`, `/about`), where it is true and useful to developers.
- **docs.plus is always lower case**, even at the start of a sentence, matching its own site.
- **Owner action (optional):** a link from docs.plus to `tiny.docs.plus/download` once Gate 5 ships.

---

## 2. App icon

### 2.1 Today's identity

- `components/brand/brand-mark.tsx` draws a white bold **"T" glyph** (font size 0.62 × the canvas, weight 700) on `BRAND_ACCENT = #bb4d00`, which is the light `--primary`, `oklch(0.555 0.163 49)` (Tailwind v4 amber-700). Variants: `rounded` (radius 0.2 × size), `square` (apple-touch, opaque), `maskable` (glyph at 0.5 × size).
- The glyph is **rendered by Satori with whatever font it loads**, so the mark's shape is not under our control and can't be reproduced in a desktop pipeline.
- `app/favicon.ico` is a **static binary** (16 and 32 px PNG frames) committed in `f824339`; nothing checks that it still matches `BrandMark`.
- The OG image (`app/opengraph-image.tsx`) is 1200 × 630, `#fafafa` background, a 16 px amber top border, the mark, "TinyDocy", the developer headline and `tiny.docs.plus · open source, MIT` in amber.
- The desktop prototype uses a **different mark**: lucide `file-text` in an amber 26 px rounded square (`.brand .m`), and a neutral "X" placeholder elsewhere.
- Platform guidance argues against a letter: Microsoft says icons "should not include typography" ([Windows app icon design](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-design)); Apple allows a mnemonic letter but notes the system doesn't apply Liquid Glass to "text and thin lines" when it segments a bitmap icon ([HIG App icons](https://developer.apple.com/design/human-interface-guidelines/app-icons)).

### 2.2 Concept directions

All three share the amber palette and a 1024 × 1024 square master.

**A. Title page (recommended).** A portrait page in the A-series ratio (1 : √2), centred, with one thick rounded **title bar** across its top and two body lines below; the second line is shorter. No folded corner (that is reserved for the `.tinydoc` document icon, so the app and its files never look alike).
- Metaphor: one literal object, a document, plus the product's structural rule (title first). Passes Microsoft's "tell what it represents without a label" test.
- Small sizes: at 16–24 px it reduces to page plus title bar, which still reads.
- Layers: page, title bar and lines are three flat shapes, which map directly onto Icon Composer groups.
- Weakness: "a page" is a common icon. The amber field and the heavy top bar carry the distinctiveness.

**B. Geometric T.** Today's "T" redrawn as two rounded rectangles (crossbar and stem), so it no longer depends on a font. Continuity with the current favicon and PWA installs.
- Strength: no change in recognition for today's sandbox visitors.
- Weakness: a letter, against Microsoft's guidance; says nothing about documents or privacy; "T" icons are everywhere (Teams, Typora, Todoist).

**C. Page on a base.** A page resting on a low rounded base or drawer, meaning "kept on your computer".
- Strength: speaks to D0 directly.
- Weakness: two metaphors (Microsoft's ceiling); the base reads as a hard drive or a tray at small sizes; the base becomes mush in tinted and clear appearances.
- **Rejected lock metaphor:** a padlock would imply encryption at rest, which the library doesn't claim ("No marketing claim the tests don't back", test strategy §5.8).

**Chosen: A.** It is the simplest literal metaphor, it is specific to this product's schema, it survives every appearance variant because the identity is the silhouette (a page with a heavy top band), and it matches the prototype's existing `file-text` intent while being our own drawing.

### 2.3 Construction (concept A)

**Palette** (all existing tokens; Tailwind v4 amber ramp):

| Name | Hex | Token today |
|---|---|---|
| amber-50 "paper" | `#fffbeb` | `--primary-foreground` |
| amber-500 | `#fe9a00` | dark `--sidebar-primary`, planned dark `--primary-ink` |
| amber-600 | `#e17100` | `--chart-3`, `--sidebar-primary` |
| amber-700 "brand" | `#bb4d00` | light `--primary`, `BRAND_ACCENT` |
| amber-800 | `#973c00` | dark `--primary`, `--chart-5` |
| neutral-300 "line" | `#d4d4d4` | — |
| zinc-700 / zinc-800 "public plate" | `#3f3f46` / `#27272a` | — |

**Plated master (macOS, iOS apple-touch, PWA `any`), 1024 × 1024, unmasked square:**

| Layer (Icon Composer group) | Geometry | Fill |
|---|---|---|
| Background | full bleed, opaque | linear gradient 120°: `#e17100` top-left → `#bb4d00` bottom-right |
| Group 1 "page" | rect x 300, y 212, w 424, h 600 (1 : 1.415), radius 44 | `#fffbeb`, opaque (glass translucency set in Icon Composer, ≤ 10 %) |
| Group 2 "title" | rect x 360, y 276, w 304, h 88, radius 44 (pill) | `#bb4d00` (4.85 : 1 on paper) |
| Group 3 "lines" | two pills h 40, radius 20: x 360, y 412, w 304; x 360, y 492, w 200 | `#d4d4d4` |

- The page's centre is the canvas centre (512, 512), as Apple asks ("keep primary content centered"). The lower third of the page is empty on purpose: room to write, and margin from the system's rounded mask.
- **No baked effects.** No shadows, highlights or bevels on the layers; the system adds Liquid Glass ([HIG](https://developer.apple.com/design/human-interface-guidelines/app-icons): "Let the system handle blurring and other visual effects"). Layers are exported as **square, unmasked SVGs** with crisp edges.
- **Final numbers are tuned in design review** at 16, 32, 128 and 1024 px; the structure above doesn't change.

**macOS appearances** (Icon Composer annotations; the HIG lists default, dark, clear light, clear dark, tinted light, tinted dark):

| Appearance | Background | Page | Title | Lines |
|---|---|---|---|---|
| Default | amber gradient | paper | brand | line grey |
| Dark | `#973c00` → `#7b3306` (stays amber: "Color backgrounds generally offer the greatest contrast in dark icons") | `#fafafa` at 92 % | `#e17100` | `#a3a3a3` |
| Clear, tinted | system | brightest layer (white) | **knock-out** (transparent hole) | knock-out at 60 % |

The title and lines are separate groups so that in clear and tinted modes they render as holes in the page. The silhouette alone (a page with a heavy top band) then carries the identity.

**Unplated (Windows, Linux, browser tab favicon), drawn on Microsoft's 48 × 48 grid:**

| Shape | 48-grid geometry | Fill |
|---|---|---|
| Page | x 8, y 2, w 32, h 44, exterior radius 2 (Microsoft: 2 px exterior, 1 px interior at 48) | `#bb4d00`, optional one-step 120° gradient within ±4 % lightness |
| Title | x 13, y 8, w 22, h 6, radius 1 | `#fffbeb` |
| Lines | h 3: y 18 w 22; y 24 w 14 | `#fffbeb` at 55 % |

- **Contrast:** `#bb4d00` measures 4.53 : 1 on the light taskbar (`#f3f3f3`) and 3.24 : 1 on the dark one (`#202020`), so the whole page passes Microsoft's "at least half of your icon passes a 3.0:1 contrast ratio on light and dark theme". **Don't use `#e17100` as the page:** 2.88 : 1 on light fails. (Computed with the WCAG formula on 2026-11-16.)
- **Hand-tuned small sizes:** 16, 20 and 24 px drop the lines and snap the title bar to whole pixels (16 px: page 10 × 14, title 6 × 2). 32 px and up keep both lines.
- Favicon SVG dark mode: `@media (prefers-color-scheme: dark)` switches the page to `#fe9a00` (8.40 : 1 on `#171717`) and the title to `#171717`.

**Maskable PWA (512 × 512):** full-bleed amber gradient; the page scaled to w 226, h 320 and centred, so its corners stay inside the safe circle of radius 0.4 × 512 = 204.8 px ([web.dev maskable icons](https://web.dev/articles/maskable-icon)). Keep `any` and `maskable` as **separate files**, as today; web.dev advises against `"any maskable"` in one icon.

**Public sandbox variant** (sandbox favicon, apple-touch and PWA icons only): the same page geometry on a **zinc plate** (`#3f3f46` → `#27272a`), page `#fafafa`, title `#fe9a00`. Unplated sandbox favicon: page `#52525b`, title `#fffbeb`. Rule: **amber means a private place** (desktop, My documents); **grey means the public sandbox**. The manifest `id` stays `/`; the sandbox manifest `name` becomes "TinyDocy Sandbox" (`short_name` too; Android truncates). Changing `name` and icons doesn't orphan installs. Design review, not an owner question.

- **Sequencing.** B1 ships the **amber** mark on today's only live surface (the sandbox), **before Gate 2**. The plan's Gate 3 clause "classic look, pixel for pixel" covers the page, not icons. **v8:** the sandbox switches to the grey variant and the "TinyDocy Sandbox" name **with the library launch flag `NEXT_PUBLIC_LIBRARY`** (Gate 5), not when W5 merges, because the distinction only matters once a private surface is public. The switch carries a CHANGELOG entry, a design review and a **Deploy note: icons already on iOS Home Screens won't update**. Until then grey would make the brand's first impression the "public" colour.
- **How two hosts get two icon sets from one Next app.** The library lives in the same app (`app/(library)/**`, web library §11) served on my.tiny.docs.plus, so root file conventions (`app/favicon.ico`, `app/icon.svg`, `app/apple-icon.tsx`, `app/manifest.ts`) can't vary by host. The plan:
  - The **root conventions are the sandbox's** set.
  - The **library layout** sets `metadata.icons` (icon, apple-touch) explicitly to library-scoped files (an `icon.svg` and `apple-icon` in the `(library)` group, or `pwa-icons` ids `library-*`). Browsers request `/favicon.ico` only when the page declares no icon, so the explicit links win. **W4 verifies** that segment-level icon files work inside a route group; `metadata.icons` alone is the fallback.
  - **W4 serves the library manifest host-aware** (its own route, or the proxy choosing by `Host`), with the amber `library-*` icon ids. The sandbox manifest keeps `id: "/"`.

**Document icon (`.tinydoc`):**
- Artwork: a white page (`#ffffff`, 1 px `#d4d4d4` outline at 32 px) with a **folded top-right corner** (fold = 22 % of width), and the **plated app mark at 44 % of the page width** centred in its upper half. No text.
- macOS: ship it as `tinydoc.icns` through electron-builder `fileAssociations[].icon` (works on every macOS the app supports). macOS 26 can also compose document icons from `UTTypeIcons` (background, badge and text keys) ([Apple forums](https://developer.apple.com/forums/thread/775581), [UTExportedTypeDeclarations](https://developer.apple.com/documentation/bundleresources/information-property-list/utexportedtypedeclarations)); badge images would have to live in the compiled asset catalog, which electron-builder's `.icon` path may not expose. **Later enhancement, verify first.**
- Windows: `tinydoc.ico` (16, 20, 24, 32, 48, 64, 256) via `fileAssociations[].icon`.
- Linux: `application-x-tinydoc.svg` plus PNGs under `hicolor/<size>/mimetypes/`, and a shared-mime-info entry for `*.tinydoc`.

**Identifiers (owner sign-off with question 1, before Gate 2):**

| Thing | Proposed value |
|---|---|
| electron-builder `appId` | `plus.docs.tinydocy` (reverse DNS of docs.plus) |
| `productName` | `TinyDocy` |
| Exported UTI | `plus.docs.tinydocy.document`, conforms to `public.data`, extension `tinydoc` |
| MIME type | `application/x-tinydoc` (local shared-mime-info only; no IANA registration planned) |
| URL scheme | `tinydocy` (already in the plan) |
| Linux `StartupWMClass` / desktop file | `TinyDocy` / `tinydocy.desktop`. S3: Electron takes the X11 class (and the Wayland app_id) from `desktopName` without `.desktop`, so set `desktopName: TinyDocy.desktop`; `xprop` then shows `"tinydocy", "TinyDocy"`. The installed file stays `tinydocy.desktop` (`syncDesktopName` off). The owner's GNOME Wayland dock check decides whether to rename it; D33 locks the choice. |

### 2.4 Every file, size and format

**Desktop (electron-builder).** The plan stages the app in `dist/desktop-app/` and points `directories.app` there, so **`directories.buildResources` must be set explicitly** to `desktop/build/resources/`. Requirements below are from electron-builder's [Icons & Images](https://www.electron.build/docs/features/icons-and-images) page.

| Platform | File (in `desktop/build/resources/`) | Content | Notes |
|---|---|---|---|
| macOS 26+ | `icon.icon` (Icon Composer bundle) | 3 groups + background, default/dark/mono annotations | electron-builder compiles it with `actool` into `Assets.car` and sets `CFBundleIconName`. **Requires Xcode 26+ and macOS 15+ on the build machine** (verify on the CI macOS runner in S3). Support is reported as landing in electron-builder 26.2 (a release-note mirror; [issue #9254](https://github.com/electron-userland/electron-builder/issues/9254) is the original request); **S3: electron-builder 26.18.0 with Xcode 26.6 on `macos-26`** writes `Assets.car` and `CFBundleIconName = Icon`. |
| macOS before 26 | `icon.icns` | 16, 32, 64, 128, 256, 512, 1024 (with @2x pairs) | Electron 38 needs macOS 12 and Electron 44 will need macOS 13 ([Electron 38](https://electronjs.org/blog/electron-38-0), [breaking changes](https://electronjs.org/docs/latest/breaking-changes)), so pre-Tahoe users see this file. S3 verifies how to ship `.icon` **and** `.icns` together (Electron Forge recommends keeping both; with electron-builder this may need `CFBundleIconFile` via `extendInfo`). **S3:** ship `icon.icns` through `extraResources` and set `CFBundleIconFile` through `extendInfo`, beside `Assets.car`. Scripts pack the ICNS and ICO (`iconutil` only verifies). |
| DMG | `icon.icns` via `dmg.icon`; `background.png` 540 × 380 and `background@2x.png` 1080 × 760 | Volume icon and window art | The DMG volume icon "still uses .icns". |
| Windows | `icon.ico` | PNG frames 16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256 | Microsoft's minimum is 16, 24, 32, 48, 256; the extra target sizes match Windows 11's scale table ([app icon construction](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction)) and cost a few KB. 16–24 are the hand-tuned frames. |
| Windows installer | none | — | **Recommend NSIS one-click per-user**, which "uses only the app icon". The assisted installer would add `installerSidebar.bmp` (164 × 314), `installerHeader.bmp` (150 × 57), 24-bit, no alpha. |
| Windows MSIX / Store | deferred | `AppList.targetsize-*` plus `_altform-unplated` and `_altform-lightunplated` sets, tiles, `StoreLogo` | **Plated vs unplated assets apply only to packaged apps.** Not in v1 (NSIS only). Listed so the masters already cover it. |
| Linux | `icons/16x16.png` … `icons/512x512.png` (16, 24, 32, 48, 64, 128, 256, 512) and `icon.svg` | Unplated mark | electron-builder accepts `NxN.png` names and installs into `hicolor/NxN/apps/`; SVG goes to `scalable/`. The icon-theme spec's minimum is a 48 × 48 PNG in hicolor; PNG is the recommended bitmap format ([icon theme spec](https://specifications.freedesktop.org/icon-theme/latest/)). |
| Linux desktop entry | electron-builder `linux.desktop` | `Name=TinyDocy`, `GenericName=Document Editor`, `Comment=Private documents on your computer`, `Categories=Office;WordProcessor;`, `Keywords=documents;writing;notes;markdown;`, `StartupWMClass=TinyDocy`, `MimeType=application/x-tinydoc;x-scheme-handler/tinydocy;` | Keys per the [Desktop Entry spec](https://specifications.freedesktop.org/desktop-entry/latest/). The scheme handler matters from the Live milestone. |
| File type | `tinydoc.icns`, `tinydoc.ico`, `mimetypes/application-x-tinydoc.{svg,png}` | Document icon | Via `fileAssociations`. S3 checks that the `.deb` installs the shared-mime-info XML. |

**Web (tiny.docs.plus and my.tiny.docs.plus).** The minimal modern set is a 32 px `favicon.ico`, an SVG icon, a 180 px apple-touch icon, and 192, 512 and maskable 512 manifest icons ([Evil Martians, How to favicon](https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs)).

| File | Today | After B1 |
|---|---|---|
| `app/favicon.ico` | static binary, 16 + 32 | generated from the master, 16 + 32, with the drift test (amber in B1, sandbox grey from the `NEXT_PUBLIC_LIBRARY` launch) |
| `app/icon.svg` (new) | — | unplated mark with the dark-mode media query; replaces `app/icon.tsx` (a 512 PNG favicon is redundant once SVG and ICO exist) |
| `app/apple-icon.tsx` | `BrandMark` square 180 | same route, new geometry (root = sandbox set) |
| `app/pwa-icons/[id]` | any-192, any-512, maskable-512 | same ids and URLs, new geometry; W4 adds `library-any-192`, `library-any-512`, `library-maskable-512` |
| `app/(library)/` icons (W4) | — | library-scoped `icon.svg` / `apple-icon` or `metadata.icons` in the library layout, amber (§2.3 "two hosts") |
| `app/opengraph-image.tsx` | T mark + developer copy | new mark; copy unchanged (sandbox register, §3.6) |
| `app/download/opengraph-image.tsx` (new, B7) | — | product register, §4.6 |
| Library manifest on my. (W4) | — | served host-aware (`name: "TinyDocy: My documents"`, `short_name: "TinyDocy"`), amber `library-*` icons |

### 2.5 One source of truth

```text
lib/brand/mark.ts            geometry (1024 canvas + 48 grid + small-size overrides) and palettes,
                             as plain data; imports nothing (like lib/pwa-icons.ts)
components/brand/brand-mark.tsx   renders <svg><rect …/></svg> from mark.ts — no font glyph — for
                             Satori only (apple-icon, pwa-icons, OG)
lib/icons.tsx                exports TinyDocyMark (built from mark.ts) for in-app use — About pane,
                             library header, /download — beside the other brand SVGs (AGENTS rule)
scripts/brand-assets.ts      mark.ts → brand/masters/*.svg → PNG frames → ICO / ICNS packers →
                             desktop/build/resources/ and app/favicon.ico
                             `bun scripts/brand-assets.ts --check` regenerates in memory and byte-compares
brand/TinyDocy.icon/         Icon Composer bundle, built by hand from brand/masters/layer-*.svg
tests/unit/brand/brand-assets.test.ts   runs --check, and asserts the .icon bundle's layer SVGs
                             equal the exported masters
```

- **Rasteriser:** try `next/og`'s `ImageResponse` from a Bun script first (already a dependency, it bundles resvg). If it doesn't run outside Next, add `@resvg/resvg-wasm` as a dev dependency (pure WASM; still goes through `bun audit` and `minimumReleaseAge`).
- **Packers:** ICO with PNG frames is a 6-byte header plus 16-byte entries; ICNS is a type-length list of PNG chunks. Both are about 40 lines each, so no new dependency. Alternatively `iconutil -c icns` on the designer's Mac. S3 picks one.
- **Generated binaries are committed** (electron-builder and Next read them directly; reviewers see them in the design review). The `--check` test stops drift, which today's `favicon.ico` already shows is a real risk. If PNG bytes differ between macOS and Linux runs (encoder or rasteriser differences), the test compares the SVG masters byte for byte and the decoded PNG frames by pixel hash instead.
- **The `.icon` bundle can't be scripted** (Icon Composer is a GUI app; it needs macOS Tahoe 26.4+ per [Icon Composer](https://developer.apple.com/icon-composer/)). The designer rebuilds it from the masters when the geometry changes; the test catches a forgotten rebuild.
- **The in-app mark** (About pane, the library header, the prototype's `.brand .m`) uses `TinyDocyMark` from `lib/icons.tsx`, replacing lucide `file-text`.

---

## 3. Visual identity

### 3.1 Wordmark and lockup

- **Wordmark:** "TinyDocy" set in **Inter SemiBold (600)**, tracking −1 %. No custom lettering in v1: the team is one owner plus agents, and Inter is already loaded (`app/layout.tsx`, `next/font`).
- **Lockup:** mark + wordmark, gap = 0.5 × mark height, wordmark cap height = 0.5 × mark height, optically centred. **Descriptor:** "by docs.plus" in Inter Regular, `--muted-foreground`, 60 % of wordmark size, on the baseline after the wordmark or on a second line.
- **Satori:** `ImageResponse` doesn't use `next/font`. B7 loads an Inter 600 TTF subset (OFL) from the repo for OG images, so the wordmark matches.
- **Don't:** recolour the mark outside the palette, add effects, put the mark on photos, or set the wordmark in another font.

### 3.2 Colour

- **Keep amber.** It is already the product's primary, the OG accent and the chart ramp, and amber-on-paper is distinct from the blues and purples of most document apps.
- **Text in amber uses `--primary-ink`** (F1, preferences §5.11): `#bb4d00` in light (5.03 : 1 on white), `#fe9a00` in dark (9.23 : 1 on background). Marketing pages use the same tokens; no new colours.
- **Fills:** `--primary` with `--primary-foreground` (white on `#bb4d00` is 5.03 : 1, paper on it 4.85 : 1) for the primary download button.
- **Never** set body text in `#e17100` or `#fe9a00` on white (3.20 : 1 and 2.13 : 1).
- **Grey is the sandbox's signal** (§2.3); the site's neutral palette stays shadcn's.

### 3.3 Typography

- **Interface and marketing:** Inter (400, 600, 700). Headline sizes on `/download`: 40/48 px desktop, 32/40 px phone.
- **Documents:** the page font presets stay as decided (C6): Default (Arial), Sans (Inter), Serif (Source Serif 4), Mono, Legible (Atkinson Hyperlegible Next). Screenshots use **Default** so they show what a new user sees.
- No new web font for the site.

### 3.4 Screenshots and illustration

- **Real UI only.** No illustrations, stock photos, people, or device mock-ups with invented content. Excalidraw and Bear weren't checked for this design; Obsidian, iA Writer and Zed all lead with real product shots ([iA Writer](https://ia.net/writer), [Obsidian](https://obsidian.md/)).
- **Content:** the **teaching Playground** (OB1) and two or three neutral sample documents with fictional names. The same content appears in the app, so a screenshot never promises something the user can't find.
- **Pairs:** every hero shot in light and dark, served with `<picture>` and `prefers-color-scheme`.
- **Per OS:** the hero is captured on each OS with its native window frame; feature crops are frameless.
- **Annotations:** none in images. Captions in HTML carry the meaning (accessible and translatable).
- **Format:** PNG masters at 2×, served through `next/image` (AVIF/WebP), each under 300 KB delivered.

### 3.5 Tone of voice

The UX copy guidelines (UX §9) apply to the website unchanged: plain and short; no blame, drama, exclamation marks, "please", "simply" or "just"; sentence case; real numbers with units; the vocabulary table (**document**, **Library**, **Local**, **Live**, **Trash**, **backup**, **Settings**). Marketing adds four rules:

1. **Every claim names its test** (test strategy §5.8). A claims table lives in the Gate 5 issue: "works offline" → the offline e2e; "nothing leaves your computer" → the no-network checks (§1.10); "no account" → no sign-in code exists.
2. **The canonical privacy sentence is the first-run copy**, verbatim: "Nothing you write leaves this computer unless you share it or keep backups in a cloud folder. Update checks send only the app version and your system." The website never rephrases it into something stronger.
3. **"No telemetry" is scoped to the app.** tiny.docs.plus has opt-in GA4; say "The app sends no usage data", never "We collect nothing".
4. **Never** "secure", "encrypted", "military-grade", "forever", or comparisons that name competitors.

Sample hero copy for `/download` (B7 puts it in `site-config.ts`):
- H1: "Your documents, on your computer."
- Sub: "TinyDocy is a free document editor for Mac, Windows and Linux. It works offline, needs no account, and shares a document only when you do."
- Button: "Download for Mac". Under it: "Version 1.0.0 beta · Apple Silicon · 142 MB · Release notes".

### 3.6 Two copy registers in `site-config.ts`

| Register | Audience | Constants | Used by |
|---|---|---|---|
| Sandbox (exists) | Developers evaluating Tiptap + Yjs | `SITE_TITLE`, `SITE_DESCRIPTION`, `SOCIAL_*`, `SITE_ANSWER`, `SANDBOX_NOTICE`, `SITE_FEATURES` | `/`, `/about`, the sandbox OG image, `llms.txt` |
| Product (new) | D0: people who want private documents | `PRODUCT_ANSWER`, `PRODUCT_FEATURES`, `DOWNLOAD_TITLE`, `DOWNLOAD_DESCRIPTION`, `PRIVACY_PROMISE` (the first-run sentences), plus OB4's `PRIVATE_OPTIONS` | `/download`, `/releases`, the download OG image, JSON-LD, `llms.txt` |

`PRODUCT_ANSWER` draft: "TinyDocy is a free, open-source (MIT) document editor for Mac, Windows and Linux that keeps your documents on your computer. It works offline and needs no account. The only automatic network request is an update check, which sends the app version and your system. You can share a document for live editing when you choose. TinyDocy is made by docs.plus."

---

## 4. Website and download page

### 4.1 Information architecture

```text
tiny.docs.plus  (public sandbox origin; GA4 opt-in; manifest id "/" frozen)
  /              sandbox editor (unchanged) + SEO intro, which gains PRIVATE_OPTIONS (OB4)
  /about         sandbox about + FAQ; gains a "TinyDocy for your computer" section → /download
  /download      product page + downloads (OB4 = Q16, Gate 5)       app/download/page.web.tsx
  /releases      desktop release notes, newest first (B6, Gate 5)   app/releases/page.web.tsx
  /releases/feed.xml   Atom feed of the same notes
  /privacy       rewritten: one page, sections per surface (B4 Gate 3, B5 Gate 4, #my-documents Gate 5)
  /terms         terms of use, linked from the share dialog (B5, Gate 4)
  /llms.txt, sitemap.xml, robots.txt

my.tiny.docs.plus  (web library, D11; strict CSP; no analytics; noindex)
  library app only; footer links to tiny.docs.plus/privacy, /download, /releases

<feed host>, e.g. releases.tiny.docs.plus  (static files only, no cookies, HSTS)
  desktop/<channel>/latest*.yml, beta*.yml, installers, SHA256SUMS
```

- **No separate marketing site.** One owner, about 10 hours a week, and a rule that `site-config.ts` is the single source of public copy. A second site would split SEO, copy and deploys. Obsidian, iA Writer and Zed each run one site with the download on it.
- **`/` stays the sandbox editor.** Its manifest `id` and `start_url` are frozen there, and its SEO ranks for the developer register.
- **`/download` is the product landing page**, not just a file list (the D0 audience arrives there from the sandbox banner, the `Public` chip, the library storage card and search).
- **Pages use the `.web.tsx` extension** so the desktop export leaves them out (architecture §3.1; OB4 already requires `/download` to be absent from the desktop build).
- **Nothing marketing-related runs on my.** The library's CSP forbids third-party scripts (web library §5.5), and its pages are `noindex` (an app with no public content).
- **Feed host name** is the owner's call (plan §8.3 provisions it); `releases.tiny.docs.plus` is a suggestion. It serves both the update feed and the download links, so one checksum list covers both.

### 4.2 The `/download` page

**Layout (top to bottom):**

1. **Hero.** Lockup, H1, sub (§3.5), primary button for the detected OS, a "Beta" badge until `1.0.0`, version, date, size, "Release notes" link, and "Other platforms and versions" (in-page link to 5).
2. **Three proof points**, each with a screenshot crop: "Stays on your computer" (Library plus readable backups as `.md` and `.tinydoc` in the TinyDocy Backups folder), "Works offline", "Share when you choose" (a live link; "the server deletes it after 30 days without edits", plan §5.3 wording).
3. **What stays on your computer** (a table): where documents live per OS (library in the app's data folder; backups in `~/TinyDocy Backups` or the chosen folder); the one automatic request (update check: app version and OS; off in Settings › Updates); what happens when you share (the document goes to the docs.plus share server; link to `/privacy#shared-documents`); Report a Problem opens your email app and sends nothing by itself; spellcheck and the Playground make no network requests.
4. **Demo video** (§4.7) with transcript.
5. **All downloads** (a table, always server-rendered): OS, architecture, format, size, SHA-256 (copy button), link.

   | OS | Builds |
   |---|---|
   | macOS | Apple Silicon `.dmg` (default) · Intel `.dmg` |
   | Windows | x64 `.exe` (NSIS, per user) |
   | Linux | x64 `.deb` (Debian, Ubuntu) · x64 AppImage (other distributions) |

6. **Verify your download.** `shasum -a 256 <file>` (macOS), `Get-FileHash <file>` (PowerShell), `sha256sum <file>` (Linux); `gh attestation verify <file> --repo docs-plus/editor` for build provenance (test strategy §1.10 supply chain); the signing identity per OS ("Developer ID Application: <name> (<Team ID>), notarized by Apple"; Windows publisher "<name>"); and the sentence **"Official downloads come only from tiny.docs.plus/download and <feed host>."** (the mirror risk from §1.2).
7. **First launch notes** (collapsed by default, one per OS):
   - **Windows SmartScreen:** "Windows may show 'Windows protected your PC' for a new version during its first days. Check that the publisher is <name>, then choose More info › Run anyway." This note is **permanent, not beta-only**: SmartScreen reputation is per file hash, so every new build starts cold, and since 2024 EV certificates no longer skip it ([Microsoft Learn](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)).
   - **Linux:** `.deb`: `sudo apt install ./TinyDocy_<version>_amd64.deb`. AppImage: make it executable, then run it. **S3 verifies two known Ubuntu issues before this copy is written:** AppImages need FUSE 2, which recent Ubuntu releases don't install by default; and Ubuntu 24.04's AppArmor limits on unprivileged user namespaces can stop Electron's sandbox in an AppImage. **Never tell users to pass `--no-sandbox`.** If the AppImage can't run sandboxed on current Ubuntu, the page recommends the `.deb` there and says so. **S3 result:** on Ubuntu 24.04 defaults (`kernel.apparmor_restrict_unprivileged_userns=1`), the AppImage starts only because electron-builder's AppRun adds `--no-sandbox` itself, and the renderer shows `Seccomp: 0`. The `.deb` installs an AppArmor profile and runs sandboxed (`Seccomp: 2`). The stock image also lacks `libfuse2t64`. So the page says "`.deb` recommended on Ubuntu 24.04+", and the AppImage note names `libfuse2t64`.
   - **macOS:** nothing to do (signed and notarized). electron-updater updates the build that is **installed**, not the machine's architecture, so an Intel build on an Apple Silicon Mac stays on Rosetta. The Intel link says "For Macs with an Intel processor", and the About pane can later suggest the Apple Silicon download when it sees `process.arch === "x64"` under translation.
8. **System requirements** (§4.3).
9. **FAQ:** Is it free? (yes, MIT) · Is my data sent anywhere? (the privacy sentence) · I use My documents in my browser; how do I move? (OB4's "Export all from there, then import the zip in the app") · Is there a phone app? (no; My documents works in a phone browser) · How do I say TinyDocy?
10. **Footer** (shared `SitePage`): Privacy, Terms, Releases, Source, Community.

**OS detection (progressive enhancement, no hydration mismatch):**
- The server renders a neutral hero ("Download TinyDocy" with three equal buttons) and the full table. Without JavaScript everything works.
- A client effect sets a `ready` flag and then the detected OS; the hero swaps to one primary button plus "Other platforms" (AGENTS: never `useState(() => detect())`).
- **Detection order:** `navigator.userAgentData.platform` where it exists (Chromium only; Safari and Firefox lack the API and Safari's UA is frozen, [MDN](https://developer.mozilla.org/docs/Web/API/NavigatorUAData/getHighEntropyValues)); otherwise the UA string (`Mac OS X`, `Windows`, `Linux`, excluding `Android`).
- **Mac architecture:** on Chromium, `getHighEntropyValues(["architecture"])` returns `"arm"` or `"x86"`; elsewhere default to **Apple Silicon** and always show "Intel Mac? Download for Intel" under the button. Apple Silicon is the safe default: macOS 26 is the last release for Intel Macs ([Tom's Guide](https://tomsguide.com/computing/macos/apple-is-ending-support-for-all-intel-based-macs-next-year-heres-whats-getting-cut), reporting WWDC 2025). **Call I made:** two DMGs, not a universal build (a universal Electron app is roughly twice the size; electron-updater picks the file matching the installed build from `latest-mac.yml`). S3 confirms.
- **Phones and iPad** (Android UA, or a Mac UA with `maxTouchPoints > 1`): "TinyDocy runs on Mac, Windows and Linux. On this device, use My documents in your browser." with a link to my.tiny.docs.plus, and the full table below for people sending the link to themselves.

**Data source:** `lib/desktop-release.json`, read at build time (static page, no runtime fetch, no CSP change):

```json
{
  "version": "1.0.0-beta.1", "channel": "beta", "date": "2027-…",
  "notesUrl": "/releases#1-0-0-beta-1",
  "notice": null,
  "requirements": { "macos": "13", "windows": "10 (64-bit)", "linuxTested": ["Ubuntu 24.04 LTS", "Fedora 41"] },
  "files": [
    { "os": "mac", "arch": "arm64", "format": "dmg", "name": "TinyDocy-1.0.0-beta.1-arm64.dmg",
      "bytes": 148897792, "sha256": "…", "url": "https://<feed host>/desktop/beta/…" }
  ]
}
```

- **Checksums are SHA-256 hex.** electron-updater's `latest*.yml` carries base64 SHA-512, which people can't compare with `shasum -a 256`. The release job (P3.1) therefore also writes `SHA256SUMS` next to the files, and B3 turns that into this JSON.
- **When it changes:** a follow-up PR after the release job, made with `gh` and started with `gh workflow run` (bot-made PRs start no workflows, AGENTS). **The page flips to a new version when that version reaches 100 % on its channel** (test strategy §5.5), so fresh installs never run ahead of the staged update.
- **Halt:** `notice` holds the "post a note on the download page" text of halt step 2; the page shows it above the hero.

**Accessibility (WCAG 2.2 AA, [W3C](https://www.w3.org/TR/WCAG22/)):**
- Download links are links, named in full: "Download for Mac, Apple Silicon, DMG, 142 MB".
- Copy buttons say what they copy ("Copy SHA-256 for TinyDocy-1.0.0-arm64.dmg") and announce "Copied" once through the existing `announce()` helper.
- Tables have `<th scope>`; checksums are in `<code>` and wrap.
- Targets at least 24 × 24 CSS px (2.5.8); visible focus (`--focus-ring`); forced-colours safe; no information only in colour or images.
- The detection swap moves no focus and makes no live announcement.
- B7 adds an axe check and a keyboard pass for `/download`, `/releases` and `/privacy` to the `chromium` project.

### 4.3 System requirements

- **Publish only what is tested** (D32: 4 macOS, 4 Windows, 2 Linux testers). The requirement lines come from `lib/desktop-release.json`, updated per release.
- **macOS minimum follows the Electron version:** 12 for Electron 38–43, 13 from Electron 44. By Gate 5 (40–52 weeks out) expect macOS 13 or later.
- **Windows:** 10 and 11, 64-bit x64. No Windows on Arm build in v1 (x64 runs emulated; unsupported, say so).
- **Linux:** x64; "Tested on <the testers' distributions>". Wayland and X11 per S3.
- **Disk:** the installer size plus the library; no fixed RAM number unless measured.

### 4.4 `/releases` (release notes and changelog)

- **Source:** `desktop/whats-new/<version>.md` (test strategy §5.4), the same files the app bundles for Help › What's New. One source, two renderings; the parser is OB3's (no new Markdown dependency; the format is bullets, bold and links).
- **Page:** newest first; each version is an `<h2 id="1-2-0">` with date, channel badge, at most 6 bullets in user voice, and the format/schema line. Security releases carry a "Security" label (test strategy §5.7). A link to the full `CHANGELOG.md` on GitHub for developers. [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) stays the repository format.
- **Atom feed** at `/releases/feed.xml`: lets people follow releases without an account or newsletter.
- **The web's ⋯ › Help › What's new** keeps linking to the GitHub CHANGELOG (onboarding §1.5): the web ships continuously and isn't in these notes.
- The in-app About pane's "Release notes" link opens the bundled page offline; a "View all releases" link there opens `/releases` in the browser (a user action, so it respects Goal 1).

### 4.5 `/privacy` and `/terms`

Today `/privacy` covers only the sandbox and analytics, and `PRIVACY_CONTACT` is empty (the page falls back to GitHub issues).

**Timing correction.** The plan lists privacy and terms as owner actions **before Gate 4**, but the test strategy's Gate 3 row requires "Privacy policy, Help pages and the support mailbox live". Resolution (**v8 review**): the **summary and `#desktop`** ship at **Gate 3** (B4); **`#shared-documents` and `/terms`** at **Gate 4** (B5); **`#my-documents`** at **Gate 5**, with the library launch. The controller and contact (`PRIVACY_CONTACT`) are owner work **before Gate 3**.

**Structure (one page, one heading per surface, anchors stable):**

1. Summary table: for each surface (public sandbox, My documents, desktop app, shared documents, this website), where your content lives and what reaches a server.
2. `#sandbox`: today's text, unchanged.
3. `#my-documents`: stored in this browser on my.tiny.docs.plus; no analytics there; eviction; Export all.
4. `#desktop`: the library and backups folder; the update check (app version and OS; off in Settings › Updates); crash information stays on the computer unless you attach it to an email; Report a Problem goes to the feedback alias (D31) only when you send it; no usage data.
5. `#shared-documents` (Gate 4): what the share server stores, for how long (30 days without edits), images and comments, how to ask for removal, the takedown route.
6. `#website-analytics`: GA4 opt-in on tiny.docs.plus only, never in the app or the library.
7. `#contact`: controller and contact (owner).

- **Agent work:** a factual inventory of every byte that leaves each surface, checked against the code and the no-network tests, written as plain sentences.
- **Owner and counsel work:** the controller identity and contact (`NEXT_PUBLIC_PRIVACY_CONTROLLER`, `NEXT_PUBLIC_PRIVACY_EMAIL`), any legally required wording, whether a legal notice or imprint is needed in the owner's jurisdiction, and the terms text. Agents don't draft legal terms beyond a placeholder structure.
- `/terms` is linked from the share dialog (plan §6) and the footer.

### 4.6 SEO, JSON-LD and social

- **Titles and descriptions** for `/download` and `/releases` come from the product register (§3.6); canonical URLs; both in `sitemap.ts`. my.tiny.docs.plus: `noindex` and a disallow-all `robots.txt`.
- **JSON-LD** (`lib/structured-data.ts`): add a `SoftwareApplication` node `@id: ${SITE_URL}/download#desktop` with `name`, `description: PRODUCT_ANSWER`, `operatingSystem` (from the release JSON), `applicationCategory: "BusinessApplication"` (as the existing node), `softwareVersion`, `downloadUrl` (the `/download` page, not a binary), `releaseNotes: ${SITE_URL}/releases`, `offers` (price 0), `isAccessibleForFree`, `license` (MIT), `screenshot`, `publisher` → the docs.plus organization. **No ratings or reviews** (the existing comment's rule). Google lists review or rating properties for the software-app rich result ([Search Central](https://developers.google.com/search/docs/appearance/structured-data/software-app)), so **expect no rich result**; the markup is for entity clarity and AI answers. Validate in B7 with the Rich Results Test and confirm the current requirement then.
- **`llms.txt`:** add the product answer, links to `/download`, `/releases` and `/privacy`, and facts: platforms, no account, the update-check sentence, where documents live, official download sources.
- **OG image for `/download`:** 1200 × 630, paper background (`#fffbeb`), the plated mark at 120 px, the lockup with "by docs.plus", H1 "Your documents, on your computer.", "Mac · Windows · Linux · Free and open source". Inter loaded into Satori. The sandbox OG keeps its developer copy and gets the new mark.

### 4.7 Screenshots and demo video

**Screenshot set (Gate 5):**

| # | Shot | How |
|---|---|---|
| 1 | Hero: Library sidebar + a document with the outline, light and dark, per OS | Owner or a tester, real machine, native frame (Playwright can't capture native title bars) |
| 2 | Fold and drag a section in the outline | Scripted, `_electron` `local` project, frameless crop |
| 3 | First-run sheet showing the privacy sentence | Scripted |
| 4 | Settings › Page (text size, width, font) | Scripted |
| 5 | Quick Open and tags | Scripted |
| 6 | Share dialog (Live milestone) | Scripted against staging |

- `scripts/capture-marketing.ts` (B8) drives the `local` project fixtures, so crops can be regenerated each minor release.
- Alt text describes what the shot shows ("A document titled 'Trip plan' with its outline beside it").

**Demo video (Gate 5):** 50–60 s, no voice-over, silent.
- **Storyboard:** 0–8 s first-run sheet (privacy sentence readable) · 8–20 s write a title and a heading, fold a section, drag it in the outline · 20–30 s Settings › Page · 30–40 s Wi-Fi off, keep writing, the status stays calm · 40–50 s Library, tags, Quick Open · 50–56 s share a document · 56–60 s end card: lockup, "Free. Mac, Windows, Linux.", `tiny.docs.plus/download`.
- **Hosting:** self-hosted MP4 (H.264) with a poster frame, under 8 MB, `preload="none"`, `controls`, **no autoplay**, no YouTube embed (no third-party script, no tracking, CSP unchanged).
- **Accessibility:** silent video needs no captions, but on-screen text is part of the content, so a **text transcript** (the storyboard as steps) sits under the player (WCAG 1.2.1 and 1.2.3 media alternative). No flashing. The page respects `prefers-reduced-motion` (nothing animates by itself anyway).
- Recorded by the owner on macOS (screen recording at 60 fps), edited by an agent-assisted pass; re-recorded only for major UI changes.

### 4.8 Launch announcement checklist (Gate 5)

Drafted in the Gate 5 issue (test strategy §5.8); the owner posts it.

- [ ] `/download` live; every link downloads; checksums verified on a second machine against `SHA256SUMS`
- [ ] `/releases` shows `1.0.0-beta.1`; the in-app What's New matches it
- [ ] `/privacy` (all sections) and `/terms` live; controller and contact filled
- [ ] Claims table: each marketing claim mapped to a passing test
- [ ] OG previews checked for `/download` and `/` (both registers)
- [ ] JSON-LD validated; sitemap resubmitted in Search Console; `llms.txt` updated
- [ ] axe and keyboard pass on `/download`, `/releases`, `/privacy`; video transcript present
- [ ] README Download section (Q16) links `/download`
- [ ] Press kit: SVG and PNG mark (plated, unplated), lockups, three screenshots, a 100-word blurb, the pronunciation line (a `/download#press` section or a folder in the repo)
- [ ] Halt rehearsed; the feedback alias watched for the first 72 hours
- [ ] Defensive domain redirect live (if registered)
- [ ] Post on the existing community channels (Discord, the docs.plus site, GitHub); Hacker News or Product Hunt only if the owner chooses
- [ ] Announcement text follows §3.5 and links the release notes

---

## 5. Assets checklist

O = owner, D = designer or agent. Effort in days of focused work.

| # | Asset | Who | Effort | Needed by | Lives in |
|---|---|---|---|---|---|
| 1 | Trademark clearance search (USPTO, EUIPO, WIPO; classes 9, 42) and the go/no-go on the name | O (counsel) | owner's call | **target P2.5; hard stop the first signed Gate 3 build** (D33) | — |
| 2 | Identifier sign-off: `appId`, UTI, MIME, scheme, `StartupWMClass`, signer name | O | 0.1 | before Gate 2 (P2.5); locked by the first signed Gate 3 build (D33) | `desktop/build/electron-builder.yml` |
| 3 | Store and registry checks (App Store, Microsoft Store, Flathub, Snap, npm, domains) | D | done 2026-11-16 | re-run before Gate 5 | this doc's §1.2 |
| 4 | Geometry module + SVG masters (plated, dark, unplated, small sizes, maskable, sandbox, document icon) | D | 1.5 | Gate 2 (placeholder acceptable), final at Gate 3 | `lib/brand/mark.ts`, `brand/masters/` |
| 5 | Icon Composer bundle (default, dark, mono annotations) | D on the owner's Mac (Tahoe 26.4+) | 0.5 | Gate 3 | `brand/TinyDocy.icon/` |
| 6 | `icon.icns`, `icon.ico`, Linux PNG set, `icon.svg` | D (script) | 0.5 | Gate 3 | `desktop/build/resources/` |
| 7 | `.tinydoc` icons (icns, ico, Linux mimetypes) + shared-mime-info | D | 0.5 | Gate 3 | `desktop/build/resources/` |
| 8 | DMG background 540 × 380 and 1080 × 760 ("Drag TinyDocy to Applications") | D | 0.25 | Gate 3 | `desktop/build/resources/` |
| 9 | Web icons from the master, sandbox variant, drift test | D | 0.5 | any time (B1) | `app/`, `components/brand/` |
| 10 | Install help pages (Gatekeeper none, SmartScreen, Linux) | D | 0.5 | Gate 3 (testers) | Help pages (P3.4) |
| 11 | Tester email: links, SHA-256 sums, install notes, feedback alias | D drafts, O sends | 0.25 | Gate 3 | release issue template |
| 12 | `/privacy` summary and `#desktop` section; controller and contact (`PRIVACY_CONTACT`). `#my-documents` follows at Gate 5 (v8). | D inventory, O approves | 1 + O | **Gate 3** (`#my-documents`: Gate 5) | `app/privacy/page.tsx` |
| 13 | `/privacy` shared documents; `/terms` | O (counsel), D structure | 0.5 + O | Gate 4 | `app/privacy`, `app/terms/page.web.tsx` |
| 14 | `/download` page (OB4 = Q16) | D | in OB4 | Gate 5 | `app/download/page.web.tsx` |
| 15 | `SHA256SUMS` from the release job and `lib/desktop-release.json` | D | 1 | Gate 3 (sums), Gate 5 (JSON) | P3.1 job, `scripts/desktop-web-release.ts` |
| 16 | `/releases` + Atom feed | D | 1 | Gate 5 | `app/releases/` |
| 17 | Product copy register, OG image, JSON-LD, `llms.txt`, sitemap | D | 1 | Gate 5 | `lib/site-config.ts`, `lib/structured-data.ts` |
| 18 | Screenshots: scripted crops + hero per OS | D + O/testers | 1.5 + 0.5 O | Gate 5 | `app/download/_media/` |
| 19 | Demo video + poster + transcript | O records, D storyboards and edits | 1 + 0.5 O | Gate 5 | `app/download/_media/` |
| 20 | Press kit | D | 0.25 | Gate 5 | `brand/press/` |
| 21 | Announcement draft and claims table | D drafts, O posts | 0.5 | Gate 5 | Gate 5 issue |
| 22 | Defensive `tinydocy.com` | O | 0.1 | any time, before Gate 5 | registrar |

**What Gate 3 testers actually need:** items 4–8, 10, 11, 12 and the `SHA256SUMS` half of 15. Everything web-facing beyond `/privacy` waits for Gate 5.

---

## 6. PR breakdown

| PR | Title | Scope | Depends on | Effort | Gate | Review |
|---|---|---|---|---|---|---|
| **B1** | `feat(brand): draw the mark from one SVG geometry` (D34) | `lib/brand/mark.ts`; `BrandMark` renders SVG rects (no glyph); `TinyDocyMark` in `lib/icons.tsx`; `app/icon.svg` replaces `app/icon.tsx`; regenerated `favicon.ico`; all web icons and the sandbox OG get the **amber** mark; masters for every variant (incl. sandbox grey, unused until the `NEXT_PUBLIC_LIBRARY` launch); `scripts/brand-assets.ts --check` and its test; CHANGELOG | D34 | 1.5 d | before Gate 2 | **Design review** (16/32/180/512, light and dark tab strips, Android mask preview) |
| (W4, W5) | existing web library PRs | W4: library-scoped icons and the host-aware manifest (§2.3). W5: the grey sandbox variant and manifest `name` "TinyDocy Sandbox", **shown only when `NEXT_PUBLIC_LIBRARY` is on** (v8), with a CHANGELOG entry and the iOS Home Screen Deploy note | B1 | +0.5 d in total | Gate 5 | in their design reviews, plus one for the launch switch |
| **B2** | `feat(desktop): app and document icons` | masters → `desktop/build/resources/` (icon.icon, icns, ico, Linux set, tinydoc icons, DMG art); `electron-builder.yml`: `directories.buildResources`, `mac.icon`, `dmg.icon`, `dmg.background`, `fileAssociations`, `linux.desktop`, MIME XML, one-click NSIS | P2.5, S3 (Xcode 26 runner, `.icon` + `.icns` together, WM class, deb MIME entry, AppImage FUSE and AppArmor, per-architecture DMGs: about 1 more day in the spike, v8) | 2 d + 0.5 d Icon Composer | Gate 3 | Design review: Dock, Finder, Launchpad (default, dark, tinted, clear), taskbar light/dark, GNOME and KDE docks, file icons |
| **B3** | `feat(release): checksums and the web release record` | the P3.1 job writes `SHA256SUMS`; `scripts/desktop-web-release.ts` writes `lib/desktop-release.json`; tester-email template | P3.1, P3.3 | 1 d | Gate 3 | SE: no secrets in the job that writes the JSON |
| **B4** | `docs(web): privacy for the desktop app and My documents` | `/privacy` restructure (§4.5 sections 1, 2, 4, 6, 7; v8: section 3, `#my-documents`, lands at Gate 5 with the library launch); `PRIVACY_PROMISE` in `site-config.ts` | owner: controller and contact (`PRIVACY_CONTACT`) before Gate 3 | 1 d | **Gate 3** | O approval |
| **B5** | `feat(web): terms and shared-documents privacy` | `/terms` page, footer and share-dialog links, `#shared-documents` | Gate 4 legal advice; P4.x share dialog | 0.5 d | Gate 4 | O + counsel |
| **B6** | `feat(web): desktop release notes page` | `/releases` + Atom feed from `desktop/whats-new/*.md` with OB3's parser; About pane link | OB3 (= Q14) | 1 d | Gate 5 | Design review |
| **B7** | `feat(seo): product copy, download OG image and JSON-LD` | product register constants; `/download` OG with Inter; `SoftwareApplication` node; `llms.txt`; sitemap; axe checks for the new pages; feeds OB4's copy | B3, OB4 | 1 d | Gate 5 | Design review |
| — | **OB4 (= Q16)**, existing | `/download` built to §4.2 (layout, detection, verify, notes, requirements, FAQ). **Re-estimate from 2 d to about 3 d** for the data-driven table, detection states and accessibility | B3, B7 | +1 d | Gate 5 | Design review (as planned) |
| **B8** | `feat(web): download page screenshots and demo video` | `scripts/capture-marketing.ts`; media in `app/download/_media/`; `<picture>` pairs; video, poster and transcript | OB1, P2.9b, Live milestone for shot 6 | 2 d + 1 d O | Gate 5 | Design review |
| **B9** | `docs: press kit and launch checklist` | press kit folder, claims table, announcement draft in the Gate 5 issue | B7, B8 | 0.5 d | Gate 5 | O |

- **Totals:** about **12.5 agent-days** (v8 correction; was stated as 11.5) (B1 1.5, B2 2.5, B3 1, B4 1, B5 0.5, B6 1, B7 1, OB4 +1, W4/W5 +0.5, B8 2, B9 0.5) and **about 2 owner-days** (Icon Composer session, recording, approvals), plus counsel time the plan already counts. The S3 spike's extra day (v8: the Xcode 26 runner, `.icon` with `.icns`, the WM class, the deb MIME entry, AppImage FUSE and AppArmor, per-architecture DMGs) is spike time, not counted here. Owner time in all: about 16 hours (plan §8.1).
- **Calibration:** at about 1 week per 11 agent-days (plan §8.2), this adds about one week spread across Gate 3 and Gate 5 work. B2 and B3 sit inside P2.5/P3.1's existing slots; B4 replaces part of the "privacy policy live" owner action. **Cut order (D41, v8):** B8's video and B6's Atom/RSS feed are the first two items on the plan's cut-first list, ahead of D30; B1–B4 are never cut (Gate 3 needs them).
- **Every PR:** CHANGELOG entry; the visible ones get a design review with screenshots before merge.

---

## 7. Owner questions

> **Answered (plan v8):** Q1 by **D33** (a, with the deadline moved to target P2.5, hard stop the first signed Gate 3 build), Q2 by **D34** (A), Q3 by **D35** (an organisation).

| # | Question | Options | Recommendation |
|---|---|---|---|
| **1** | **Keep the name "TinyDocy", with "by docs.plus" as the endorsement, and the identifiers in §2.3?** | (a) Keep; counsel runs a clearance search (USPTO, EUIPO, WIPO; classes 9 and 42), with Tiny Technologies' registered "Tiny®" as the named concern, **before the first Gate 2 build**. (b) Rename now. (c) Keep without a search. | **(a).** The name already has a footprint (site, SEO, storage keys, docs) and no exact collision turned up. A search is cheap now; a rename after Gate 2 means a migration release, after Gate 5 a broken install base. If counsel flags it, rename before P2.5. |
| **2** | **Which icon direction?** | (A) Title page. (B) Geometric T. (C) Page on a base. | **(A).** A literal document with the product's title-first rule, no letters (Microsoft's guidance), survives Apple's tinted and clear modes as a silhouette, and leaves the folded corner for `.tinydoc` files. |
| **3** | **Whose name signs the builds?** The Developer ID name (macOS) and the Windows publisher name appear in system dialogs and on `/download`. | (a) An organization (docs.plus's legal entity, if one exists). (b) The owner as an individual. | **(a) if an entity exists**: it keeps a personal name off every install dialog and survives a change of maintainer (K15). Apple's organization enrolment needs a D-U-N-S number; check whether Azure Artifact Signing accepts the chosen identity type. If enrolment already started under (b), keep it and say so on `/download`. |

---

## 8. Calls I made (check these while reading)

- **Two Mac DMGs** (Apple Silicon default, Intel offered), not a universal build. Size and electron-updater's per-arch manifests argue for it. **S3 confirmed:** one invocation writes both DMGs and zips, one `latest-mac.yml` lists both zips, and an Intel install requests the x64 zip.
- **NSIS one-click per-user** installer, so no installer bitmaps.
- **No MSIX/Store** in v1; Windows plated/unplated asset sets are deferred with it.
- **The sandbox gets a neutral variant** and the name "TinyDocy Sandbox" in its manifest, behind the `NEXT_PUBLIC_LIBRARY` launch (v8; was "in W5"), not B1; installs are not orphaned (`id` unchanged), but iOS Home Screen icons won't update (a Deploy note).
- **`/download` flips to a version at 100 % rollout**, not on release day.
- **The privacy page's desktop section moves to Gate 3** to satisfy the test strategy's Gate 3 row.
- **OB4 grows by about a day.**
- **Not researched:** Bear's and Excalidraw's pages (the brief listed them as examples); Obsidian, iA Writer and Zed were checked. USPTO/EUIPO/WIPO were not searched (owner or counsel).

## 9. Risks

| Risk | Mitigation |
|---|---|
| Counsel advises against the name late | Target P2.5, hard stop the first signed Gate 3 build (D33, §1.4; plan K26); keep all name strings in one constants module per target |
| electron-builder's `.icon` path fails on the CI runner or drops pre-Tahoe icons | S3 checks Xcode 26 on the runner and ships `.icns` alongside; fallback is `.icns` only (system segments it on Tahoe) |
| Fake installers on mirror sites | "Official downloads" sentence, checksums, provenance attestation, defensive domain |
| SmartScreen warnings scare testers and users | Permanent note on `/download`, signed builds, the publisher name shown so it can be checked |
| Linux AppImage can't run sandboxed on current Ubuntu | Confirmed by S3: AppRun adds `--no-sandbox` itself on Ubuntu 24.04 defaults. `.deb` recommended there; never tell users to pass `--no-sandbox` |
| Marketing copy outruns the tests | Claims table in the Gate 5 issue; the first-run sentence is the ceiling |
| Committed icon binaries drift from the master | `--check` test in `bun run test` |

## 10. Sources

- Apple, Human Interface Guidelines, App icons (layers, Liquid Glass, appearances, 1024 px, text guidance): https://developer.apple.com/design/human-interface-guidelines/app-icons
- Apple, Icon Composer: https://developer.apple.com/icon-composer/
- Apple Developer Forums, document icons from `UTTypeIcons` on macOS 26: https://developer.apple.com/forums/thread/775581
- Apple, `UTExportedTypeDeclarations`: https://developer.apple.com/documentation/bundleresources/information-property-list/utexportedtypedeclarations
- Microsoft Learn, Construct your Windows app's icon (sizes, scale table, targetsize, unplated): https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction
- Microsoft Learn, Design guidelines for Windows app icons (metaphor, no typography, 48 grid, contrast): https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-design
- Microsoft Learn, SmartScreen reputation: https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation
- freedesktop.org, Icon Theme Specification: https://specifications.freedesktop.org/icon-theme/latest/
- freedesktop.org, Desktop Entry Specification: https://specifications.freedesktop.org/desktop-entry/latest/
- electron-builder, Icons & Images: https://www.electron.build/docs/features/icons-and-images
- electron-builder issue #9254 (Icon Composer support): https://github.com/electron-userland/electron-builder/issues/9254
- electron-builder release notes (mirror): https://newreleases.io/project/github/electron-userland/electron-builder/release/electron-builder@26.3.0
- Electron 38.0.0 (macOS 12 minimum): https://electronjs.org/blog/electron-38-0
- Electron breaking changes (macOS 13 from Electron 44): https://electronjs.org/docs/latest/breaking-changes
- web.dev, Maskable icons: https://web.dev/articles/maskable-icon
- Evil Martians, How to favicon: https://evilmartians.com/chronicles/how-to-favicon-in-2021-six-files-that-fit-most-needs
- MDN, `NavigatorUAData.getHighEntropyValues()`: https://developer.mozilla.org/docs/Web/API/NavigatorUAData/getHighEntropyValues
- Tom's Guide, macOS 26 is the last release for Intel Macs: https://tomsguide.com/computing/macos/apple-is-ending-support-for-all-intel-based-macs-next-year-heres-whats-getting-cut
- Google Search Central, Software app structured data: https://developers.google.com/search/docs/appearance/structured-data/software-app
- W3C, WCAG 2.2: https://www.w3.org/TR/WCAG22/
- Keep a Changelog 1.1.0: https://keepachangelog.com/en/1.1.0/
- Tiny Technologies, attribution requirements (Tiny® and TinyMCE® trademarks): https://tiny.cloud/legal/attribution-requirements
- Tiny, Tiugo Technologies acquires TinyMCE: https://tiny.cloud/news/tiugo-technologies-acquires-tinymce
- Name checks: App Store Tiny Doc https://apps.apple.com/us/app/tiny-doc-a-pdf-scanner-app/id556500145 · App Store DOCY https://apps.apple.com/us/app/docy-scan-document-pdf-via-cam/id6741674128 · Product Hunt Tiny Docs https://www.producthunt.com/products/tiny-docs · tinyDOC https://github.com/lrusso/tinyDOC2 · whois, the `.app` registry RDAP, npm, the Flathub search API and the Snap find API run on 2026-11-16
- Landing and download pages: Obsidian https://obsidian.md/ and https://obsidian.md/download · Zed https://zed.dev/download · iA Writer https://ia.net/writer
- docs.plus: https://docs.plus
