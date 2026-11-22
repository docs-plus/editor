# TinyDocy on phones and tablets (web, v1)

> **Owner answers (plan v8, 2026-11-16)**, which override the open questions and calls below:
> - **D36 (MQ1 a, MQ2 a):** **full support for phones and tablets in v1**, chosen over the reviewers' "phone floor" split. Gated on real devices: the owner's iPhone, a bought mid-range Android (about US$250), a device cloud for the 8 beta weeks, and 3 phone testers. **All PRs here (M18–M28) are v1.** Public v1 (Gate 5): 40–52 weeks; Gate 3: 20–27 weeks (plan §8.2).
> - **D41 (MQ3):** a conditional D23 ledger line for M19: editor attributes ≤ 40 B, plus an undo handler ≤ 80 B **only if M18 shows native undo mutates the DOM**. M27's hardware-keyboard listener stays out of the editor chunk. D41 also pre-approves cutting first, ahead of the D30 order: M23's in-app-browser banner, M27's shortcut glyphs and M22's tablet drag (after the brand design's B8 video and B6 feed).
> - **Staff and HoE review (v8), applied below:** PT-D6 is scoped by build target, never per render, and code opts out through `HTMLAttributes` options (§5.7); PT-D8 flushes without compaction on hidden, and M18 tests "switch app within 100 ms, then kill" (§6.4); the Home Screen deletion copy ships only after M18 verifies it (§3.3); the handoff page's Copy link uses S1b's `link.ts` (M25); the §9.4 checklist runs at Gate 5 and stable promotions only; five design reviews, not four (§10); M22 checks dnd-kit's activation constraint (§5.4). Comments gain the 640–767 px sheet over the right, and web library W-D7 takes the host flag (§14).

- **Status:** Draft for owner review (2026-11-16), amended by plan v8 (D36, D41). Nothing is built yet.
- **Scope:** the **web** on phones and tablets: the public sandbox (`tiny.docs.plus`), the web library (`my.tiny.docs.plus`, D11), and share links. Native mobile apps stay a non-goal (plan §1). v1 is the one combined public release (D6), so everything here targets Gate 5 unless a row says otherwise.
- **Parent documents** (each wins for its own feature; this document only adds the phone and tablet layer):
  - [Plan v8](2026-11-15-desktop-local-first-design.md): goals, non-goals, PR ids, gates, D0–D41
  - [Web library](2026-11-16-web-library-design.md): storage, eviction (§3), several tabs (§4), states (§9), W2–W12
  - [Details spec](2026-11-15-desktop-documents-and-editor-details.md): §4 page preferences, §5 editor details (E4, E14), §8 sharing and the handoff page
  - [Desktop UX spec](2026-11-15-desktop-ux-design.md): sidebar (§4.5), Quick Open (§4.3), copy rules
  - [Preferences](2026-11-16-preferences-design.md) (W13 sheet below 640 px, Page popover as a sheet), [Comments](2026-11-16-comments-design.md) (§11.2 phones: bottom sheet), [Search and links](2026-11-16-search-linking-design.md), [Onboarding](2026-11-16-onboarding-templates-import-design.md) (practice copy, D29), [Test and release strategy](2026-11-16-test-release-strategy.md)
- **Verified against the code** on 2026-11-16: `hooks/use-keyboard-inset.ts`, `hooks/use-is-breakpoint.ts`, `components/document-editor/{document-editor.tsx,document-editor.scss,mobile-toolbar-content.tsx}`, `components/smart-toolbar/{smart-toolbar.scss,selection-bubble.tsx,coarse-pointer.ts,slash/slash-menu.tsx,phone/*,color/swatch-preview.ts}`, `components/toc-sidebar/*`, `components/tab-bar/tab-bar.tsx`, `extensions/heading-drag/heading-drag-plugin.ts`, `components/pwa/install-app-button.tsx`, `lib/pwa/install-prompt.ts`, `lib/collab-session.ts`, `lib/continue-position.ts`, `app/layout.tsx`, `app/globals.css`, `app/manifest.ts`, `tests/e2e/toolbar-ladder.spec.ts`, `node_modules/prosemirror-history` and `@tiptap/extension-collaboration` (undo input handling), `CHANGELOG.md` phone entries.
- **Tags:** **[unverified]** = no primary source confirmed it; **[inference]** = our reasoning from sources; **[device]** = must be confirmed on a real device by spike M18 before the dependent PR merges.
- **PR numbering:** `M18`–`M28`. `M1`–`M17c` already belong to the smart-toolbar contract (M15 is "Continue where you left off"); a search of `docs/` and `CHANGELOG.md` found nothing above M17c. Other ids (W, P, OB, LK, Q) are referenced, never restated.
- **Sources** are in §13. Owner questions are in §11.

---

## 0. Summary

| # | Decision | Why |
|---|---|---|
| PT-D1 | **Phones and tablets are a supported v1 web target** for the sandbox, the web library (create, edit, organise), share links, comments and presence. "Supported" means iOS/iPadOS Safari 26 and its Home Screen web app, and Chrome for Android (current and previous stable). Firefox for Android and Samsung Internet are **best effort**: no gate, bugs fixed when cheap. **Answered by D36: full support in v1.** | People open share links on phones whatever we plan. The web library is the only private place a phone user has, because there is no mobile app. |
| PT-D2 | **Layout follows width and pointer, never the user agent.** The existing 768 px boundary stays: below it, the phone bar and sheets; at or above it, the row and popovers, with 44 px targets on a coarse pointer. Hover-only affordances key on the event's `pointerType === "mouse"`, so an iPad trackpad gets them and a finger never does. **OS capability switches** (Open in app, folder import, install steps) key on the **platform**: iOS, iPadOS or Android, from `navigator.userAgentData.platform` or the existing `isIos()` (which already catches iPadOS's Mac user agent). | iPadOS 26 windows can be any size, iPad Safari reports a Mac user agent, and an iPad mini portrait is 744 px wide, so layout can't use the platform. But a touchscreen Windows laptop has a coarse pointer and still runs the desktop app, so capabilities can't use the pointer. |
| PT-D3 | **On iPhone, install before you write.** In a Safari tab, the library's first run offers "Add to Home Screen" first, because the installed app has its own, separate, empty library and is exempt from the 7-day cap. Android gets the native install prompt from a button, never automatically. No nag: each prompt appears once, in context, and is always reachable from the storage card. | WebKit exempts Home Screen web apps from the 7-day cap, and their storage is isolated from Safari. Installing after writing strands the documents in the tab. |
| PT-D4 | **Never fight the platform's text UI.** Native selection handles, the native callout and long-press stay. No floating bubble on touch (already true). Formatting comes from the docked phone bar and its selection cells (existing), and from the row on tablets. No custom context menu on touch. | `-webkit-touch-callout` doesn't suppress the selection callout, and reports say it fails on iOS 26.1 even for links. Fighting it produces two menus. |
| PT-D5 | **No drag on phones.** Sections, blocks, sidebar rows and folders move through menus: **Move up**, **Move down**, **Move to…**. Tablets keep outline drag with a long-press activation (250 ms, 5 px) on a visible handle. In-editor section drag stays mouse only. | `heading-drag` listens to mouse events only, the outline handle is invisible until `:hover`, and a distance-only sensor turns every vertical scroll into a drag. A menu is accessible and works one-handed. |
| PT-D6 | **Autocorrect and autocapitalize turn on for prose** (`autocapitalize="sentences"`, no `autocorrect="off"`), **scoped by build target** (v8): the web library and the sandbox on touch; desktop unchanged unless decided otherwise. The attributes are set once per build, never per render. Code blocks and inline code opt out through the extensions' `HTMLAttributes` options. iOS shake and three-finger undo route to the Yjs undo manager (the bytes: D41, conditional on M18). | The `off` values came from the original Tiptap template (`git log`: present since `init`), not a decision. They make writing prose on a phone keyboard slow. |
| PT-D7 | **Export on phones: files go to Downloads; the share sheet carries what it can.** Export all is a download (a zip can't be shared on Chromium). Send a copy offers **Share…** for HTML and PDF after a "Preparing…" step, gated on `navigator.canShare`, and shares Markdown as text. Import takes files and backup zips; folder import is hidden on phones. | MDN's shareable list has no `.zip`, `.md` or `.tinydoc`. `share()` needs a fresh user activation, which an async zip or serialisation outlives. |
| PT-D8 | **Durability on phones assumes the tab can die silently.** `visibilitychange` → hidden is the only flush we count on, and it **flushes without compacting** (v8): it writes the pending batch and nothing else, so it finishes before iOS can suspend the page. `pagehide` and `beforeunload` are bonuses. The library's batch window (≤ 1 s) is the most a killed tab can lose, and the Can't save state says to stay in the tab, because no exit guard works on phones. | WebKit: when iOS kills the WebContent process for memory, `pagehide` does not fire, by design. Safari has no Page Lifecycle API. |
| PT-D9 | **Share links on a phone open in the browser.** The handoff page hides **Open in app** on iOS, iPadOS and Android (platform, not width: PT-D2). **Open in browser** joins into this browser's library (W10). In an in-app browser (Gmail, Slack, WhatsApp) **Just look** becomes the primary action, with "To keep it, open this link in Safari / Chrome." On iOS outside the Home Screen app, the page offers **Copy link**, and the library gains **Open a link…** (paste) for people whose library lives in the Home Screen app. | iOS opens links in Safari, never in a Home Screen web app, so a tapped link lands in the Safari library. In-app browsers keep their own storage, which can disappear. |
| PT-D10 | **Real devices gate the release**: 3 iPhones, 2 iPads, 3 Android phones and 1 Android tablet, through the owner's devices plus a device cloud for the beta weeks (**owner question MQ2**). Playwright device emulation covers layout and taps on every PR, nothing more. | Emulation has no virtual keyboard, no IME, no selection handles, no callout, no jetsam, no Home Screen and no share sheet. Those are where phone editors break. |

---

## 1. What exists today

| Fact (checked in code) | Where | Consequence |
|---|---|---|
| Below **768 px** the editor swaps the sticky row for a **docked phone bar** (44 px cells) and an **Aa sheet**, one lazy chunk; desktop never fetches it. | `document-editor.tsx` (`useIsBreakpoint()` = `max-width: 767px`), `mobile-toolbar-content.tsx`, contract A6 | The phone editing surface exists and is tested. This design extends it; it doesn't rebuild it. |
| The bar rides **above the on-screen keyboard** through `useKeyboardInset()`: `innerHeight − visualViewport.height − offsetTop`, measured once per frame on `visualViewport` `resize`/`scroll`, reset after focus leaves editable content (an iOS offset bug). | `hooks/use-keyboard-inset.ts` | Works on iOS and Chrome Android without the VirtualKeyboard API. Only the phone bar uses it today; sheets with text fields need it too (§4.6). |
| While text is selected, the bar swaps to **eight 44 px selection cells**: B I U A▁ ✎▁ 🔗 🖌 ✕. | `phone-selection-cells.tsx`, CHANGELOG "Phone selection bar (§6)" | Full at 352 px. There is no room for a ninth cell (Comment) on a 375 px phone (§5.5). |
| The **selection bubble** is fine-pointer only, and phones never fetch its chunk. | `selection-bubble.tsx:14,79`, `bubble/selection-bubble-view.tsx:69-70` | **Gap:** a touch tablet at ≥ 768 px has neither the bubble nor the selection cells. Its formatting comes from the row, which is fine, but a Comment entry is missing (§5.5). |
| The **responsive ladder** is container queries on the row, with touch thresholds (T2 1,560 → T5 1,012 px) for 44 px targets. `toolbar-ladder.spec.ts` sweeps touch widths 1440, 1224, 1096, 920, 824, 768. | `smart-toolbar.scss:18-29`, `toolbar-ladder.spec.ts:12` | Real iPad widths 744, 820, 834, 1024, 1032, 1180, 1194 and 1366 are not in the sweep (M27 adds them). |
| The **"/" menu** has 44 px rows on a coarse pointer, keeps the phone keyboard on tap, and flips above the caret near the phone bar. | `slash/slash-menu.tsx:75,226,494` | Works on phones. Keep it. |
| **Tooltips and shortcut glyphs are hidden on a coarse pointer** at any width. | CHANGELOG ("Touch tablets") | An iPad with a Magic Keyboard never learns a shortcut (§5.10). |
| Colour **hover preview** needs `(hover: hover) and (pointer: fine)`. | `swatch-preview.ts:125` | Correct for touch. An iPad trackpad gets no preview; acceptable. |
| **Safe areas**: `viewport-fit=cover`, and `--safe-area-*` tokens are used by the tab strip, the phone bar and its sheet, the shell and the skeleton. `appleWebApp.capable` is set. | `app/layout.tsx:49-57`, `app/globals.css:10-15`, `phone.scss` | New library chrome (header, drawer, sheets) must use the same tokens. |
| No `maximum-scale` or `user-scalable=no`. | `app/layout.tsx` | Pinch zoom works. Keep it that way. |
| **Install**: Chromium's `beforeinstallprompt` is captured early; iOS gets a one-line "Add to Home Screen" popover. Both live behind a small icon in the status strip. | `lib/pwa/install-prompt.ts`, `components/pwa/install-app-button.tsx` | The library on its own origin needs its own manifest and install copy (W4, W6). The iOS hint must warn about the separate library (web library §3.3). |
| **Editor attributes**: `autocomplete="off"`, `autocorrect="off"`, `autocapitalize="off"`, browser-default spellcheck. Present since the first commit. | `document-editor.tsx:127-131` | Inventory H2 and details E14 left this for "later". This design decides it (§5.7). |
| **Section drag in the editor** uses `mousedown`/`mousemove` only. | `extensions/heading-drag/heading-drag-plugin.ts:259-303` | Dead on touch. Its handle must not show on touch (§5.4). |
| The **outline's drag handle** is `opacity: 0` until `.toc-sidebar-item-row:hover`, 16 × 22 px, `touch-action: none`. The outline and the sandbox tab strip use `PointerSensor` with a **distance-only** activation (5 px and 8 px). | `toc-sidebar.scss:115-135`, `toc-sidebar.tsx:152`, `tab-bar.tsx:160` | On touch the outline handle is invisible, and a horizontal swipe on the tab strip can start a tab drag instead of scrolling **[inference; M18 confirms]**. |
| **Undo input events**: only `prosemirror-history` handles `beforeinput` `historyUndo`/`historyRedo`. The Collaboration extension replaces that history with the Yjs undo manager, which handles only key bindings. | `grep historyUndo node_modules/...` | iOS **shake to undo** and the **three-finger swipe** probably send a `historyUndo` that nothing intercepts, so the browser's native undo could mutate the DOM behind ProseMirror **[device]** (§5.9). |
| **Continue chip phone tap fix:** the 375 px touch test tapped Go while the page was still coasting after a touch pan; Linux Chromium treats that tap as stopping the scroll, not as a click (as phones do). The test now waits until the page is at rest before tapping. | `tests/e2e/continue-chip.spec.ts:542-550`, CHANGELOG "Continue chip phone test waits for the page to stop" | Every new touch spec (M28) must wait for scroll momentum to stop before a tap, with that helper extracted to `tests/e2e/helpers/`. |
| The sandbox's device copy **flushes on `pagehide` and on `visibilitychange`**. "Continue where you left off" records on blur, hidden and `pagehide`. | `lib/collab-session.ts:322-323`, `lib/continue-position.ts:245-246` | Already uses the right hook. The library batcher (W2) flushes on hidden too (web library W-D2). |

---

## 2. What works on phones and tablets in v1

**Rule:** every feature that exists on the web exists on phones, unless a row below says why not. A missing feature is labelled where people look for it, never silently absent.

| Feature | Phone (< 768 px) | Tablet (≥ 768 px, touch) | Decision and why |
|---|---|---|---|
| **Sandbox editing** | Yes (today) | Yes (today) | Unchanged, apart from the touch fixes in §5. |
| **Web library: create, edit** | Yes | Yes | The only private place a phone user has. Same `IdbDocStore`, same durability rules. |
| **Organise: folders, pins, Trash, sort** | Yes, through menus and the **Move to…** sheet | Yes; sidebar drag works with a mouse or trackpad only | Menus replace drag (PT-D5). Four folder levels display as a drill-in list on phones, not a tree. |
| **Tags** (D7) | Yes: add, remove, filter, rename, merge, colours, in sheets | Yes | Tag dialogs are lists and fields, so they fit a sheet. |
| **Search** (D24: metadata only) | Yes: Quick Open as a full-screen sheet from 🔍 | Yes: the centred dialog; ⌘O with a hardware keyboard | No new matcher. The field gets `enterkeyhint="search"`. |
| **Links between documents** (LK1, LK2, LK4, LK5) | Insert from the Link cell; following a link: tap | Same; hover preview with a trackpad only | Hovercards need hover; on touch the first tap on a document link opens it (no preview step). **LK3 `[[`** works if it ships; it is first to cut (D30). |
| **Templates** (TM1) | New from template: yes (a sheet). Save as template: yes | Yes | Lists and a name field. |
| **Page preferences** (D10) | Yes: the Aa sheet's **Page** row opens the Page content as a sheet (preferences §4.3) | The Page popover | Width choices matter less on a phone: below 640 px the page is full width whatever the setting, and the sheet says so ("On this screen the page always fills the width."). Text size, style, font and spacing apply. |
| **Settings** (W13) | Full-height sheet with drill-in panes (preferences §4.2) | The dialog | Already designed. |
| **Comments** (D9) | Read, reply, resolve, add. Highlights only; tapping one opens the thread in a **bottom sheet** (comments §11.2) | Markers and the 360 px panel; the rail in landscape when the page fits | Add-comment entry points are in §5.5. |
| **Presence** (P4.7) | Avatar row collapses to one avatar + count; People list in a sheet; **Go to** works | As desktop | Remote carets render as on desktop. Names stay "not verified". |
| **Share** (W10: Invite to edit, Manage sharing) | Yes, all of it, in sheets | Dialogs | The consent copy gains the Safari-tab line on iOS (web library §8.3). **Copy link** uses the Clipboard API from the tap; **Share link…** uses `navigator.share({ url })`. |
| **Opening share links** (P4.3) | Yes: **Open in browser**, **Just look**; no **Open in app** | Same on iPad and Android tablets (no desktop app there). A touchscreen Windows or Linux laptop keeps **Open in app**: the switch is the platform, not the pointer (PT-D2) | PT-D9. |
| **Import** (IM1, IM2, IM4) | `.md`, `.html`, `.tinydoc`, `.docx` (IM3, if it ships), backup `.zip`, from the Files picker | Same, plus drag from Files into the window on iPad **[device]** | **Folder import is hidden on iOS, iPadOS and Android** (platform, not width: an iPad at 1,180 px still has no folder picker). iOS has no folder picker for web pages **[unverified]**, and Android's `webkitdirectory` support is partial **[unverified]**; M18 confirms both. A zip covers backups. |
| **Export** (P2.10, W7) | Download, or the share sheet where `canShare` allows (§3.5) | Same | PT-D7. |
| **Backup folder** (W8, Chromium) | Hidden | Hidden on Android tablets | `showDirectoryPicker` doesn't exist on Android Chrome or iOS. The card never mentions it there. |
| **Print / Save as PDF** (E6) | Yes: the OS print sheet (iOS can save or share the PDF) | Yes | The print stylesheet is shared. |
| **Find and replace** (P2.11) | Find: yes, from ⋯ › Find, as a bar above the phone bar. Replace: in the same bar behind "Replace" | Yes; ⌘F with a hardware keyboard | Phones have no ⌘F, so ⋯ is the entry. |
| **Word count** (E3) | Yes, ⋯ › Word count, as a sheet | Popover | — |
| **Block move and duplicate** (E4, menu only) | In the Aa sheet's **Block** section | In ⋯ › Block | Menu only everywhere in v1, so phones lose nothing. |
| **Outline** | The existing overlay, as a full-width sheet from the left; each row has a **⋯** with Fold, Move up, Move down | Docked or overlay by width (details §4); drag with long-press | PT-D5. |
| **Multiple tabs** (W3 mirrors, Edit here) | Yes; rare on phones | Yes | iOS suspends background tabs that hold locks, which is why W3 already has the 3 s timeout and **Edit here anyway**. |
| **Command palette (Alt+/)** | No: phones have no keyboard shortcut to open it; every action is in the bar, the Aa sheet or ⋯ | With a hardware keyboard: yes | The palette is a keyboard surface (contract). No change. |
| **What's New** (OB3) | No (web gets none, onboarding §1.5) | No | — |
| **Offline** | Yes: the library is offline by nature; the sandbox keeps its 14-day copies; the service worker shell | Yes | Unchanged. |

**Honestly out of scope in v1** (each listed in Help › "Using TinyDocy on a phone"):
- A native app, App Store or Play Store listing, or a TWA wrapper.
- Syncing a library between a phone and a computer (plan non-goal). The path is **Export all** → **Import**, or sharing the one document live.
- Receiving files from other apps through the share sheet (Web Share Target). Android only, and it needs the installed app; v1.1 candidate.
- Push notifications for comments or joins. Home Screen web apps support Web Push on iOS 16.4+, but nothing in v1 sends notifications.
- Handwriting (Scribble on iPad) as a feature. It goes through the same text input path and is covered by the IME tests, nothing more.
- Drag and drop on phones (PT-D5).

---

## 3. Storage, install and export on phones

### 3.1 The contexts, and what each guarantees

The web library design §3.1 is the full table. The phone-specific facts:

| Context | Library | 7-day cap | Install effect |
|---|---|---|---|
| **iOS / iPadOS Safari tab** | Its own | **Yes.** After 7 days of Safari use without a tap, click or key press on the site, WebKit deletes all script-writable storage, IndexedDB included. Scrolling doesn't count. | Installing creates a **separate, empty** library |
| **iOS / iPadOS Home Screen web app** | Its own, isolated from Safari | **Exempt.** WebKit: "The first-party domain of home screen web applications is exempt from ITP's 7-day cap on all script-writeable storage." Storage pressure still applies. | It is the installed context. iOS 26 opens every Home Screen site as a web app unless the person switches off "Open as Web App". |
| **iOS in-app browser** (Gmail, Slack, WhatsApp, Instagram: `SFSafariViewController` or a `WKWebView`) | The host app's, not Safari's **[inference]** | Unknown per host **[unverified]** | Can't install from here |
| **Chrome for Android tab** | Shared with the installed app | No cap; best-effort eviction under storage pressure | Same storage; installing usually helps `persist()` |
| **Chrome for Android installed (WebAPK)** | Same as the tab | No cap | — |
| **Android in-app browser** (Custom Tabs) | Chrome's profile for Custom Tabs **[inference]**; a raw `WebView` has its own | — | — |

**Consequence for the design:** on iPhone and iPad, the Home Screen app is the only browser context with a durable library short of a backup. On Android, the tab is already as durable as the installed app.

### 3.2 Install without nagging

**Principles**
- Never a modal, an interstitial or an automatic prompt on first visit.
- One contextual suggestion per trigger, dismissible, never repeated after dismissal. Always reachable later from the storage card and ⋯ › **Install app**.
- Never on the public sandbox's first visit. The sandbox keeps today's small install icon.

**iOS and iPadOS Safari tab (library origin)**

| When | What | Copy |
|---|---|---|
| **Library first run** (empty, no marker cookie, Safari, not standalone) | The first-run empty state gets a **choice card** above [New document]. It is the only first-run state with two equal paths. | **"Keep your documents safe on this iPhone"** · "Safari can delete documents stored in a tab after 7 days without a visit. Added to your Home Screen, My documents gets its own storage that Safari doesn't clear. Do this first: the Home Screen app starts with its own empty library." · [How to add to Home Screen] [Use in Safari for now] |
| [How to add to Home Screen] | A sheet with three steps and the real icons: Share (□↑), **Add to Home Screen**, keep **Open as Web App** on, **Add**. | "1. Tap Share □↑ in Safari's toolbar. 2. Tap **Add to Home Screen**. 3. Keep **Open as Web App** on, then tap **Add**. Then open My documents from your Home Screen." |
| [Use in Safari for now] | Card closes for good. The storage card keeps the Safari-tab state (web library §9). | — |
| Library has documents, Safari tab, the install sheet is opened from the card | The web library §3.3 line comes first | "The Home Screen app starts with an empty library. Export your documents here first, then import them in the app." [Export all…] |
| **Standalone, empty** | Web library §9 "Installed Safari app, empty" | Unchanged |

**Android Chrome**

| When | What | Copy |
|---|---|---|
| `beforeinstallprompt` captured, library has ≥ 1 document, not installed | A one-line row in the storage card, and ⋯ › **Install app** | "Install My documents to open it like an app. Your documents stay in this browser either way." [Install] |
| After `appinstalled` | Call `persist()` again (web library §3.3). If granted, the card changes to persistent and says so politely. | "This browser has agreed to keep your documents." |
| `beforeinstallprompt` never fires (already installed, or criteria not met) | Nothing. ⋯ shows no Install item. | — |

**In-app browsers.** Detection is a user-agent heuristic for copy only (`FBAN`, `FBAV`, `Instagram`, `Line/`, `GSA/` and the like), never for features. When it matches on the library origin, a banner: "You're in another app's browser. Documents saved here may not stay. Open this page in Safari to keep them." [Copy link] (Chrome on Android: "in Chrome"). **[unverified heuristic; M18 lists the user agents of the 5 most common hosts]**

### 3.3 What the storage copy says on phones

The web library §3.2 and §9 copy stands. Phone deltas only:

| State | Phone copy (replaces or adds) |
|---|---|
| Chip `This browser` on phones | Icon only (⛁) in the header, with the label "Stored in this browser" for assistive technology. The popover becomes a sheet. |
| Safari tab card | "Stored only in Safari on this iPhone. Safari deletes it if you don't open My documents for 7 days of browsing. Keep a backup, or use the Home Screen app." [Export all…] [How to add to Home Screen] (iPad says "iPad".) |
| Home Screen app card (persisted or not) | "Stored only in this app on this iPhone. Deleting the app from your Home Screen deletes these documents. Keep a backup." [Export all…] **v8:** the middle sentence ships only after M18 verifies it; until then the card reads "Stored only in this app on this iPhone. Keep a backup." |
| Android card, not persistent | Unchanged from the web library, plus the Install row (§3.2). |
| Backup reminder (Safari tab: 3 days) | Unchanged interval. The pill sits above the phone bar on the library home, never over the editor. |
| **Can't save** on a phone | Adds: "Stay in this tab until it says Saved. Phones can close background tabs without warning." The `beforeunload` guard is still armed; on phones it is best effort (§6.4). |

"Deleting the app deletes these documents" is **[inference]** from Home Screen app storage being per-app; M18 confirms it on iOS 26, and **the sentence doesn't ship until it does** (v8 review).

### 3.4 Moving a library between Safari and the Home Screen app

There is no automatic copy (web library §3.3). The manual path on one iPhone:
1. In Safari: Export all… → the zip downloads to Files › Downloads.
2. In the Home Screen app: Import… → pick the zip in Files.

The Home Screen app's empty state names exactly this. Help › "Using TinyDocy on a phone" shows it with screenshots. **Export all must be reachable from a Safari tab with documents in two taps** (storage card → Export all).

### 3.5 Export on mobile

| Action | Phone and tablet behaviour |
|---|---|
| **Export all** (W7) | Always a **download** of `TinyDocy backup <date>.zip`. iOS asks "Do you want to download…?" and saves to Files › Downloads. Android saves to Downloads. Done copy: "Backup downloaded. On iPhone, find it in Files › Downloads." (the second sentence on iOS only). No share-sheet path: `.zip` isn't on the shareable list. |
| **Send a copy** › HTML | A sheet row. Tap → "Preparing Q4 plan.html…" → the row becomes **[Share…] [Download]**. Share is a second tap, so `navigator.share({ files })` runs inside a fresh activation. Shown only when `navigator.canShare({ files: [file] })` is true; otherwise Download alone. |
| **Send a copy** › Markdown | **[Share as text]** calls `navigator.share({ title, text })`, which reaches Notes, Mail and chat apps. **[Download .md]** saves the file. `.md` isn't shareable as a file on Chromium. |
| **Send a copy** › TinyDocy document | Download only (`.tinydoc` isn't shareable). Copy: "Downloaded. Open it on a computer with TinyDocy, or import it in My documents." |
| **Send a copy** › PDF | Print… opens the OS print sheet; iOS offers Save to Files and Share from there. |
| **Copy as Markdown** | Clipboard API from the tap. |
| `share()` rejects with `AbortError` | Silent (the person cancelled). Any other error: "Couldn't open the share sheet. [Download]". |

**Two-step share is deliberate:** a document's HTML is serialised headless (web library §6.1) and may take more than a frame on a phone; transient activation can expire before it finishes **[inference]**. Preparing first keeps one predictable flow on every engine.

---

## 4. Layout and navigation

### 4.1 Width bands

| Band | Width | Pointer | Toolbar | Library sidebar | Outline | Comments |
|---|---|---|---|---|---|---|
| **Phone** | < 640 px | any | Phone bar + Aa sheet (today) | Drawer from the left | Sheet from the left | Highlights; thread in a bottom sheet |
| **Large phone / small tablet** | 640–767 px (phone landscape, iPad mini portrait 744, narrow iPadOS windows) | any | Phone bar (today's 768 boundary) | Drawer | Sheet | Markers if the gutter allows (≥ 28 px), else highlights; panel as a 360 px sheet over the right |
| **Tablet** | 768 px up to the docking threshold | coarse or fine | The row, ladder T4–T5 with 44 px targets on coarse | Drawer until the main area fits (§4.3) | Overlay or docked by the existing rule (details §4) | Markers + panel |
| **Wide** | above the docking thresholds | any | The row | Docked | Docked | Rail when the page fits (comments §11.2) |

- **Pointer never changes the band**; it only changes target sizes (44 px on coarse) and hover-only affordances (PT-D2).
- **iPad mini portrait (744 px) gets the phone bar.** That is intended: a 744 px page with a 1,012 px touch ladder would be at T5 and still crowded. The bar is tested at 744 (M27).

### 4.2 Phones: one document at a time, list first

```text
Library home (phone)                    Document (phone)
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ ☰  My documents      🔍  ⛁   │        │ ‹  Q4 plan         👥  ⇪  ⋯   │  ← safe-area-top
├──────────────────────────────┤        ├──────────────────────────────┤
│ Back up your documents  ›    │ pill   │ Q4 plan                      │
│ RECENT                       │        │ Budget assumptions ...       │
│ Q4 plan          2 min ago ⋯ │ 48 px  │                              │
│ Trip notes       Yesterday ⋯ │ rows   │                              │
│ PINNED                       │        │                              │
│ Reading list            📌 ⋯ │        ├──────────────────────────────┤
│                              │        │ ↶ ↷  Aa  ¶▾  ≡▾  ⇥  +▾       │  phone bar (today)
│              [ + New ]       │ FAB    ├──────────────────────────────┤
└──────────────────────────────┘        │        (keyboard)            │
                                        └──────────────────────────────┘
```

- **The library home is a list** (Recent, Pinned, then Library folders as drill-in rows). ☰ opens the full sidebar as a drawer: Library tree, Tags, Trash, Storage, Public sandbox ↗, Settings.
- **Opening a document pushes it** onto `history.state` (web library §5.3), so the system Back gesture and ‹ return to the list. No in-app tabs on phones; the switcher is the list, Recent in the drawer and 🔍 Quick Open.
- **Header (document):** ‹ Back, the title (truncated, tap to rename, details §2.3), presence (Live documents only), **Share** (⇪), ⋯. The `This browser` chip moves into ⋯ and the storage card on phones.
- **[ + New ]** is a 56 px floating button on the home list only, above the safe area, never over the editor.
- **The sandbox keeps its tab strip** on phones (today). It already scrolls horizontally and pads for the safe area; M22 fixes the touch sensor so a swipe scrolls instead of dragging.

### 4.3 Tablets: when the sidebar docks

- UX §4.5 says the sidebar becomes an overlay below 720 px. On tablets that is too late: an iPad portrait (820 px) with a 240 px sidebar leaves 580 px for a 624 px Standard page card.
- **Rule for library hosts on the web:** the sidebar docks only when the window is at least **240 px + the page card width** (details §4: `measure × text size + 96`), computed from preferences and never measured. Otherwise it is the overlay drawer. At Standard and 16 px that is 864 px: iPad portrait gets the drawer, iPad landscape (1,180 px) docks.
- The person's open/collapsed choice is kept, as UX §4.5 requires; only the presentation follows the width.
- **Desktop may adopt the same rule** (it is the outline's rule, one level up); this design doesn't change desktop.

### 4.4 The toolbar on tablets

- The touch ladder already collapses the row to fit at every width down to 768 px. M27 adds the real iPad widths (744, 820, 834, 1024, 1032, 1180, 1194, 1366) to `toolbar-ladder.spec.ts`, in portrait and landscape, with the simplified toolbar on and off.
- **iPadOS 26 windows** can be resized freely (Split View and Slide Over were removed). Resizing crosses the 768 px boundary; `useToolbarFocusHandoff` already keeps focus in the toolbar that replaces the other.

### 4.5 Sheets

All phone surfaces use the shadcn `Sheet` (`components/ui/sheet.tsx`), as the Aa sheet does.

| Surface | Phone | Tablet |
|---|---|---|
| Aa (text format), Page | Bottom sheet (today) | Popover from the row |
| Comments thread | Bottom sheet, half height, drag up to full; the reply field rides the keyboard (§4.6) | Panel, 360 px over the right side |
| Quick Open | Full-screen sheet, field at the top, keyboard up | Centred dialog |
| Share, Manage sharing, consent | Full-height sheet | Dialog |
| Settings | Full-height sheet with drill-in (W13) | Dialog |
| Move to…, tags, New from template | Bottom sheet with a list | Dialog |
| Outline | Left sheet, 85% width, max 360 px | Overlay or docked |
| Library sidebar | Left drawer, 85% width, max 320 px | Docked or drawer (§4.3) |

- **Every sheet:** a visible title, a 44 px close button, Esc closes, focus trapped and returned, the page behind `inert` (the Aa sheet's pattern, `setPageInert`). Swipe-down to dismiss is a bonus, never the only way.
- **Safe areas:** bottom sheets pad `--safe-area-bottom`; left drawers pad `--safe-area-left` (landscape notch); full-height sheets pad top and bottom.
- **Motion:** sheets slide in 200 ms. Under reduced motion (OS or the D22 Motion setting) they appear without sliding.

### 4.6 The virtual keyboard

- **One measurement for the whole page.** M20 moves `useKeyboardInset`'s computation into a small store (`lib/keyboard-inset.ts`, `useSyncExternalStore`) that writes `--keyboard-inset` on `<html>` once per frame. The phone bar keeps its clearance logic; sheets with a text field (comment reply, Quick Open, rename, tag name, share name) set `bottom: var(--keyboard-inset)` and a `max-height` of the visual viewport. One listener set, removed when nothing subscribes.
  - **As built (M20):** `lib/keyboard-inset.ts` holds one `visualViewport` `resize`/`scroll` pair and one `document` `focusout`, reference-counted across `useKeyboardInset()` (the phone bar), `useKeyboardInsetVars()` (CSS-only consumers) and `onViewportWidthChange()`; the last release removes them and both variables. While subscribed, `<html>` carries `--keyboard-inset` and `--visual-viewport-height` (px), each written only when it changes, at most once per frame. `hooks/use-keyboard-inset.ts` is gone.
  - **Every bottom sheet rides it** (`components/ui/sheet.tsx`): the popup is `bottom: var(--keyboard-inset, 0px)` and `max-height: min(85dvh, var(--visual-viewport-height, 85dvh))`, subscribed only while open. Sheets without a field (the Aa sheet) are unaffected in practice: opening one moves focus out of the editor, so the keyboard closes and the inset returns to 0 a frame later. A sheet that sets its own `max-h-*` (the Aa sheet's `60dvh`) must write it as `min(…, var(--visual-viewport-height, …))` if it holds a field.
- **No VirtualKeyboard API.** `navigator.virtualKeyboard.overlaysContent` and `interactive-widget=overlays-content` are Chromium-only; Safari has neither. The `visualViewport` path already works on both, and two code paths would double the test matrix.
- **Keep Chrome's default `interactive-widget=resizes-visual`.** It matches iOS (the keyboard shrinks the visual viewport, not the layout viewport), so the existing inset math holds on both.
- **Hardware keyboard on iPad:** the inset is 0, except for the floating shortcuts bar iPadOS shows above a hardware keyboard **[device: does it shrink the visual viewport?]**. If it does, the formula already accounts for it.
- **Orientation change:** on `visualViewport` `resize` while the editor has focus, the caret is scrolled back into view once, after the frame settles (`requestAnimationFrame`, then `editor.commands.scrollIntoView()`). No transaction with steps, so no Yjs traffic.
  - **As built (M20):** the store reports a changed layout width (`innerWidth`) once the frame settles; keyboard and pinch-zoom resizes change only the visual viewport and are ignored. The phone bar's lazy chunk scrolls the caret back when the width changes under it, when it mounts (a rotation to portrait) and when it unmounts (a rotation past 768 px, where the row toolbar takes over), each only while the editor has focus. **Not covered yet:** a tablet rotating while staying at or above 768 px (iPad 820 ↔ 1180): no lazy chunk loads there and the editor chunk takes 0 B; it lands with the first tablet chunk (M21/M22).
- **Typing near the bottom:** ProseMirror's `scrollMargin` already includes the bar and keyboard clearance (`SCROLL_CLEARANCE`).

### 4.7 Safe areas and notches

- Header and full-height sheets: `--safe-area-top`. Phone bar, FAB and bottom sheets: `--safe-area-bottom`. Landscape: left and right on the shell, drawers and sheets (today's pattern).
- **Status bar in the Home Screen app:** `statusBarStyle: "default"` stays (dark text on the light theme). The theme toggle already updates `theme-color`, which iOS uses for the status bar area **[device: confirm on iOS 26 standalone]**.
- **Never** place a control inside the home-indicator area; the phone bar already sits above it.

---

## 5. Touch editing details

### 5.1 Selection

- Native selection handles and the native callout (Cut, Copy, Paste, Look Up, Translate, Writing Tools) stay untouched. No `-webkit-touch-callout: none`, no `user-select` tricks in the editor, no `preventDefault` on `contextmenu` or `selectionchange`.
- Formatting a selection: the phone selection cells (phones), the row's context slot (tablets). The callout and our bar never overlap: the callout floats at the selection, the bar is docked at the bottom.
- **Node selections** (an image, a Mermaid diagram, a table cell range): tapping selects the node; its own toolbar (HyperMultimedia, Mermaid) shows. These packages render their own popovers; M18 checks each is usable at 375 px with 44 px targets and files upstream issues where not.

### 5.2 Long-press

- **In the editor:** native only (text selection, link preview on iOS). No custom menu.
- **Library rows, outline rows, tabs:** long-press does nothing custom. Each row has a visible **⋯** button (44 × 44 px on coarse) that opens the row's menu as a sheet. Rows set `-webkit-touch-callout: none` and `user-select: none` on themselves only, so a long-press on a row neither selects its text nor shows a callout. Rows are buttons, not links, so iOS shows no link preview.

### 5.3 Tap targets

| Element | Coarse pointer | Source |
|---|---|---|
| Toolbar cells, sheet buttons, ⋯ buttons, close buttons | ≥ 44 × 44 CSS px (today for the bar) | Apple HIG 44 pt; WCAG 2.5.5 (AAA) 44 px |
| Library and outline rows | 48 px tall, full-width hit area | Material 48 dp |
| Inline controls that can't grow (fold chevrons in the editor gutter) | ≥ 24 × 24 px visible, 44 px hit area by padding, ≥ 8 px from the next target | WCAG 2.5.8 (AA) 24 px |
| FAB | 56 px | Material |

The heading **fold chevron** in the editor gutter is the one known small target; M22 measures it on a 375 px phone and pads its hit area.

### 5.4 Moving sections, blocks and documents on touch

| What | Phone | Tablet (touch) | Mouse or trackpad |
|---|---|---|---|
| Section, in the editor | Outline row ⋯ › Move up / Move down (`moveSection()`) | Same | Drag handle (today) |
| Section, in the outline | Row ⋯ › Move up / Move down | **Drag after a 250 ms press within 5 px** on a handle that is **visible on coarse pointers**, plus the ⋯ menu | Drag (today) |
| Block | Aa sheet › Block › Move up / Move down / Duplicate (E4) | ⋯ › Block | Format menu (E4) |
| Document into a folder | Row ⋯ › Move to… (sheet) | Same | Drag (P2.7b) |
| Sandbox tab order | Row ⋯ is not added; tabs reorder by drag after a 250 ms press | Same | Drag (today) |

- **The in-editor drag handle never shows on a coarse pointer** (`@media (pointer: coarse)` hides it; it is mouse only today and stays so).
- dnd-kit's touch activation: `{ delay: 250, tolerance: 5 }` for touch, distance for a mouse. **v8 review: M22 first checks whether dnd-kit's activation constraint can vary by pointer type**; if it is static per sensor, use separate `MouseSensor` and `TouchSensor` instances (each with its own constraint) instead of one `PointerSensor`, and test that one gesture never starts two drags. The `KeyboardSensor` stays.
- **Move up / Move down announce** the result politely: "Moved “Budget” above “Timeline”." Focus stays on the row's ⋯ so repeated moves are quick.

### 5.5 Adding a comment on touch

| Band | Entry |
|---|---|
| Phone | In documents where `canComment()` is true (Live documents; web library documents too **[inference: comments §6.3 lists local desktop documents, not web library ones; this design proposes the web library match desktop, an amendment in §14]**; never the sandbox or the Playground), the selection cells' **🖌 Paint format** cell is replaced by **💬 Comment**. Paint format moves to the Aa sheet's selection section. The sandbox keeps 🖌. |
| Tablet (touch, ≥ 768 px) | The row's comment count button (comments §11.7) becomes **"💬 Comment"** while the selection is non-empty, and opens the panel with a draft for that range. With no selection it opens the panel, as on desktop. |
| Any, hardware keyboard | ⌥⌘M on iPad (comments §11.1). |
| Any | ⋯ › Comment, and the palette with a hardware keyboard. |

- The face of a cell depends on the **document kind**, which doesn't change while the document is open, so "fixed faces" holds within a document.
- The draft opens in the bottom sheet on phones, focus in its field, keyboard up, the sheet riding the keyboard (§4.6). Post is a 44 px button; ⌘Enter works with a hardware keyboard.

### 5.6 The "/" menu on phones

Keep today's behaviour: opens on a typed "/", taps keep the keyboard up, 44 px rows, flips above the caret, stays between the row and the bar. Additions:
- **The Insert ▾ cell** in the phone bar is the discoverable path; "/" stays the fast path. The placeholder "Type / for blocks" (OB2) shows on phones too; it is accurate there.
- iOS needs the "123" layer to type "/". Nothing to fix; the Insert cell covers it.
- **Composition:** "/" commits immediately on Gboard and iOS keyboards **[device]**; the trigger checks a one-character local insert, so a "/" inside a composition never opens the menu. M18 confirms on Gboard with Japanese and Persian layouts.

### 5.7 Autocorrect, autocapitalize and spellcheck

**Decision (PT-D6):**

| Where | `autocorrect` | `autocapitalize` | `spellcheck` |
|---|---|---|---|
| Editor root (prose), web library and sandbox builds (v8: by build target; desktop unchanged unless decided otherwise) | not set (on) | `sentences` | not set (browser default) |
| Title (first heading) | inherits | inherits (`sentences` capitalises the first word) | inherits |
| Code blocks (`pre`), through the extension's `HTMLAttributes` option | `off` | `off` | `false` |
| Inline code (`code` mark), through the extension's `HTMLAttributes` option | `off` | `off` | `false` |
| Link URL fields, tag names, share names | `off` for URLs; on for names | `off` for URLs; `words` for names | `false` for URLs |

- **Set once per build target, never per render (v8):** the editor attributes come from a constant chosen at build time (`APP_TARGET`), so the extensions array keeps its identity and Tiptap never calls `setOptions` (AGENTS). The code opt-outs are static `HTMLAttributes` options on the code-block and inline-code extensions.
- **Why on:** a phone keyboard without autocorrect and capitalisation makes prose slow and error-prone. `off` came from the template, not a decision.
- **Risk:** Gboard suggestions and autocorrect are where ProseMirror's Android bugs live (Enter with a bolded suggestion, duplicated text after a 5 s pause). Our `prosemirror-view` is 1.42.9, after the published fixes. M18 runs the IME list (§5.8) with autocorrect on before M19 merges; if a data-corrupting bug appears, M19 ships `autocapitalize="sentences"` alone and leaves `autocorrect="off"`.
- **iOS Smart Punctuation** curls quotes and dashes at the keyboard, independent of the D20 smart-quotes switch and of `autocorrect` **[device: confirm it ignores `autocorrect="off"` inside code]**. If it curls quotes in code, the code-block docs say so; we don't fight the OS. The preferences design notes that Smart Punctuation ignores the D20 smart-quotes switch (v8).
- **Bytes:** the root attributes cost nothing extra (strings change). The code-block and inline-code attributes add a few bytes to the editor chunk **[measure in M19]**; they go on the D23 ledger as D41's attributes line (≤ 40 B).

### 5.8 IME composition with Yjs

- **Where the risk is:** remote updates arriving while someone composes (Gboard on every Latin word; iOS predictive text; CJK, Persian and Arabic keyboards). ProseMirror defers DOM updates during composition and commits steps as it goes, so collaborators see uncomposed text, which is acceptable. The danger is a remote change in the **same text node** during a composition on Android, which can duplicate characters.
- **Where it can't happen:** a library document that isn't Live has one writer (W3). The risk exists in the sandbox and in Live documents only.
- **Rules for our code (every PR):**
  - Nothing of ours dispatches a transaction while `view.composing` is true, except in reply to the composing input itself. Today's eager plugins (`render-once`, TOC, `slash-trigger`, caret block, action preview) are audited in M19.
  - No `contenteditable="false"` islands inside text blocks (they break Android's IME connection); our only non-editable nodes are block-level node views.
- **Device test list (M18, then at Gate 5 and each stable promotion, v8; weekly betas don't run it):** for Gboard (English, Japanese, Persian), Samsung Keyboard, iOS (English with predictive text, Japanese Kana, Persian):
  1. Type a sentence with autocorrect on; accept a suggestion; press Enter on a bolded suggestion.
  2. A second client types in the **same paragraph** at 5 characters a second while the device composes.
  3. Compose at the end of a bold run, in an empty table cell, in a list item, in the title.
  4. Pause 6 s mid-word, then continue (ProseMirror's Android composition timeout).
  5. Dictation (iOS microphone key, Gboard voice).
  6. Undo after each, with the bar's ↶.
  Pass: the text equals what was typed on both clients, no duplicated characters, caret where expected.

### 5.9 Undo and redo by gesture

- **Visible:** the phone bar has ↶ and ↷ (today). That is the primary path.
- **iOS shake to undo and three-finger swipe / tap:** routed to the editor's undo. A tiny eager handler in the editor chunk listens to `beforeinput` with `inputType` `historyUndo` or `historyRedo`, calls `preventDefault()`, and runs the Yjs `undo`/`redo` command. This is the same contract `prosemirror-history` implements for non-collaborative editors.
- **Before building:** M18 records what iOS 26 Safari and Chrome Android actually send for these gestures in a Tiptap + Collaboration editor, and whether native undo changes the DOM today. If nothing is sent, M19 drops the handler.
- **Bytes:** an estimated 60–80 B gz **[estimate]**. **D41:** a conditional ledger line of ≤ 80 B, spent only if M18 shows native undo mutates the DOM.

### 5.10 iPad with a hardware keyboard or trackpad

- **Shortcut parity:** the editor's keymap is the web keymap (⌘B, ⌘I, ⌘K, ⌘Z, ⇧⌘Z, Alt+/, ⌘F in the library). iPadOS sends ⌘ as `metaKey`, so it works today **[device: confirm Alt+/ isn't eaten by the ÷ character on iPad layouts]**.
- **Discoverability:** holding ⌘ on iPad shows Safari's own shortcut list, not ours, and iPadOS 26's menu bar shows Safari's menus. So:
  - The **⌘/ shortcut sheet** (onboarding §2.2) is on the web too, from ⋯ › Keyboard shortcuts.
  - **Shortcut glyphs in menus come back after the first hardware key press** with ⌘, Ctrl or Alt in a session: a `data-hardware-keyboard` attribute on `<html>`, set once by a passive `keydown` listener, unhides the glyphs that the coarse-pointer rule hides today. Tooltips stay hidden on touch. **D41: the listener lives outside the editor chunk** (in the lazy shell code), and the glyphs are on D41's cut-first list.
- **Trackpad and mouse on iPad:** iPadOS reports `pointerType === "mouse"` for the trackpad. Hover-only affordances (tooltips, the outline drag handle reveal, link hovercards) key on the event's `pointerType`, not on `(hover: hover)` media queries, so a finger never triggers them and a trackpad does (PT-D2).

---

## 6. Performance on mid-range phones

### 6.1 Reference devices

- **Mid-range Android:** Samsung Galaxy A25 or A35 class (2024, 6 GB RAM), Chrome stable, Gboard. Emulated in CI as Chromium with **4× CPU throttling** and the "Fast 4G" profile.
- **Low-end check:** Moto G (2024) class, 4 GB RAM, by hand before Gate 5.
- **iPhone:** iPhone SE (3rd gen) or iPhone 13, iOS 26.

### 6.2 Budgets

| Budget | Target on the mid-range Android | How it is checked |
|---|---|---|
| Sandbox first load: skeleton painted (LCP) | ≤ 2.5 s, Fast 4G, cold cache | `mobile-perf` (new, M28): Chromium, 4× CPU, network profile, 5 runs, median. Gate with 1.5× slack on PR; exact on the device before Gate 5. |
| Sandbox: first editable document | ≤ 4.0 s cold; ≤ 1.5 s warm (service worker) | Same |
| Library home from IndexedDB, 200 documents | ≤ 800 ms warm | `mobile-perf` |
| Typing, keystroke to next paint, p95 | ≤ 50 ms at 100 headings; ≤ 100 ms at 1,000 headings | `performance.spec.ts` gains a 4× CPU variant in `mobile-perf`; A/B toolbar on/off stays ≤ 10% |
| Phone bar and Aa sheet open | ≤ 100 ms to first frame after tap (chunk already fetched) | Same |
| Comment sheet open (300 threads) | ≤ 100 ms | Same |
| Editor chunk | No change for phones. Everything in this design is lazy, except M19's ledger lines. | `check-editor-chunk-size.ts` |

- **INP** stays under 200 ms ("good") for every tap in the phone bar and sheets at 4× CPU.
- Absolute numbers gate with slack only; real-device numbers are recorded in the release checklist (test strategy §1.4).

### 6.3 Large documents

- `content-visibility: auto` on off-screen blocks, render-once and the fast TOC already carry large documents. On phones, the caret-block exception (`CaretBlockVisible`) matters more, because the keyboard and bar shrink the viewport.
- **Memory:** a 1,000-heading document plus its Y.Doc is measured on the iPhone SE in M18 (Safari Web Inspector timeline). If a tab is killed while editing a document of that size on a 4 GB device, the release notes name a size above which phones are "best effort", and the editor shows nothing new.

### 6.4 Tab discards and durability

- **iOS kills background tabs** under memory pressure without `pagehide`. Chrome for Android discards background tabs (`document.wasDiscarded` on reload) and freezes them.
- **What already protects edits:**
  - Library: batched appends (250 ms after the last edit, 1 s at most) and a flush on `visibilitychange` → hidden (W-D2).
  - Sandbox: the device copy flushes on hidden and `pagehide` (`collab-session.ts:322-323`); unsynced edits upload on the next visit.
- **What this design adds (M20):**
  - A test hook asserts that switching apps (hidden) starts the flush **in the same task**, not after a timer. **As built (M20):** `tests/unit/lib/collab-session-offline.test.ts` ("flush when the page is hidden") shows the sandbox's device-copy write starts in the `visibilitychange` task, before a `setTimeout(0)` queued ahead of it (microtasks only). `tests/unit/lib/platform/local-session-hidden-flush.test.ts` pins the library's `DocHandle.flush()`: the append is issued synchronously and nothing compacts, even with compaction due. The library's own `visibilitychange` wiring is W-D2's; it must call `flush()`, never `compact`.
  - **The hidden flush never compacts** (v8): it writes the pending batch only; compaction waits for idle or close while visible.
  - **M18 tests "switch app within 100 ms, then kill"** on the owner's iPhone and the Android: type, switch apps within 100 ms, kill the browser from the app switcher, reopen; at most the batch window is missing.
  - "Continue where you left off" already records on hidden; nothing to add.
  - The `beforeunload` guard stays armed for Can't save, but the copy no longer relies on it (§3.3).
- **Worst case:** a tab killed while visible (rare: iOS kills the foreground tab only on a crash) loses at most the unflushed batch, about 1 s of typing. That matches plan goal 2.
- **On return:** a discarded tab reloads from IndexedDB; the sandbox reconnects once (no burst; Throttle bans reconnect loops).

### 6.5 Battery

- No timers while hidden: the toolbar settle timer, the outline rebuild and the awareness heartbeat pause on hidden (the heartbeat is Hocuspocus's; the socket is suspended by iOS anyway).
- Remote carets: ~~awareness updates are already coalesced; a phone sends its caret at most every 100 ms~~ **Checked in M20 (2026-11-22): not true today.** `@tiptap/y-tiptap`'s cursor plugin publishes on every view update whose relative selection changed, which is every typed character and caret move. The sandbox's `HocuspocusProvider` (`lib/collab-session.ts`) leaves `flushDelay` at its default `false`, so each awareness change goes out as its own frame at once: the rate is the typing rate (about 5–15 frames a second, faster in IME bursts), with no 100 ms floor. Library documents have no provider, so nothing is sent. M20 changes nothing; **[decision: owner]** whether to add a 100 ms awareness throttle. Setting the provider's `flushDelay` would also batch document updates, so a throttle would wrap only the awareness send, ship dark behind a flag, and move the caret-latency check into the collaboration perf A/B.
- No animations loop; sheet motion is CSS transitions only.

---

## 7. States and copy

Phone-specific states only; everything else uses the web library §9 and plan §5.5 copy.

| State | Trigger | Where | Copy | Actions |
|---|---|---|---|---|
| **iOS first run (Safari tab)** | Library empty, no marker, WebKit on iOS/iPadOS, not standalone | Choice card in the empty state | "Keep your documents safe on this iPhone" · "Safari can delete documents stored in a tab after 7 days without a visit. Added to your Home Screen, My documents gets its own storage that Safari doesn't clear. Do this first: the Home Screen app starts with its own empty library." | [How to add to Home Screen] [Use in Safari for now] |
| Install steps (iOS) | [How to add…] | Sheet | "1. Tap Share □↑ in Safari's toolbar. 2. Tap Add to Home Screen. 3. Keep Open as Web App on, then tap Add. Then open My documents from your Home Screen." | [Done] |
| Install (Android) | Prompt captured, ≥ 1 document | Storage card row, ⋯ › Install app | "Install My documents to open it like an app. Your documents stay in this browser either way." | [Install] |
| In-app browser | UA heuristic, library origin | Banner (`status`) | "You're in another app's browser. Documents saved here may not stay. Open this page in Safari to keep them." ("Chrome" on Android) | [Copy link] |
| Width on phones | Page sheet below 640 px | Line under Width | "On this screen the page always fills the width." | — |
| Folder import hidden | iOS, iPadOS, Android | Import sheet footer | "To import a folder, use a computer, or import a TinyDocy backup zip." | — |
| Preparing a copy | Send a copy row tapped | Row | "Preparing Q4 plan.html…" | — |
| Ready to share | Prepared, `canShare` true | Row | "Q4 plan.html is ready." | [Share…] [Download] |
| Can't share this type | `canShare` false | Row | "This browser can't share this file. You can download it." | [Download] |
| Export all done (iOS) | Download started | Pill | "Backup downloaded. Find it in Files › Downloads." | — |
| Share link opened on a phone | `/s/` on iOS, iPadOS or Android | Handoff page | Title "A live document on TinyDocy" · "Anyone with this link can edit it." · iOS outside the Home Screen app adds: "Using TinyDocy from your Home Screen? Copy this link and open it there with Open a link…" | **[Open in browser]** [Just look] · [Copy link] (iOS only) · Report |
| Share link in an in-app browser | `/s/` + UA heuristic | Handoff page | "To keep this document, open the link in Safari. Here you can look at it without saving." | **[Just look]** [Copy link] [Open in browser anyway] |
| Link copied | [Copy link] | Polite status | "Link copied. Treat it like a password." | — |
| Open a link… | Library ⋯ or drawer | Sheet with a field | "Paste a TinyDocy share link. Copy it from the message it came in, or tap Copy link on the page that opened in Safari." | [Open] [Cancel] |

**Why [Copy link] on the handoff page:** the page strips the secret from the address bar with `history.replaceState` (plan §5.4), so copying the address from Safari gives a dead link. The button copies the full link from memory. Putting the secret on the clipboard is acceptable because the person starts it with a tap, exactly as the sharer's own **Copy** button does (details §8.2); the page never writes it anywhere else.
| Moved by menu | Move up/down | Polite status | "Moved “Budget” above “Timeline”." | — |
| Can't save (phone) | Write failed | Banner (`alert`) | Web library copy + "Stay in this tab until it says Saved. Phones can close background tabs without warning." | Same as web library |

**Tone:** say what happens to the person's work (UX §9). "iPhone" and "iPad" by name where the platform is known; "this phone" otherwise.

---

## 8. Accessibility on phones and tablets

- **Text size:**
  - Our own text size control (14–32 px, D19, preferences §4.3) is in the Aa sheet's Page row. It scales the document only.
  - **Pinch zoom and browser text zoom** (Safari's aA › text size, Chrome's text scaling) must work: no `maximum-scale`, no fixed-height text containers, the bar and sheets reflow at 200%. M27 adds a 200% browser-zoom pass at 375 px to the visual checks.
  - **iOS Dynamic Type** reaches web pages only through `font: -apple-system-body`, which would replace our type scale. Not adopted in v1.
  - **Android OS text scale:** Chrome 146 ships `<meta name="text-scale" content="scale">`, which makes `rem` follow the OS font slider. **Adopt it in v1 only if the touch ladder and the phone bar pass at 130% and 200%** (M27 measures; the ladder's thresholds are in px while its contents are in rem). Otherwise v1.1.
- **Reduced motion:** sheets, drawers, the Move announcements and comment cards don't animate under the OS setting or D22's Motion = Reduce.
- **Contrast:** D22's Increase contrast applies to sheets and the bar. Forced colours don't exist on iOS or Android browsers; no extra work.
- **Targets:** §5.3. Spacing ≥ 8 px between adjacent targets on coarse pointers.
- **Structure:** every sheet is a `dialog` with a title; drawers are `navigation` landmarks ("My documents"); the phone bar stays one `role="toolbar"` (contract); Move up/down and handoff state changes are announced politely; nothing moves focus on its own except opening and closing a sheet.
- **Orientation:** both orientations always; nothing locks orientation (WCAG 1.3.4). The manifest sets no `orientation`.
- **One-handed reach:** primary actions on phones sit in the bottom half (bar, FAB, sheet buttons); the header holds navigation and Share only.

---

## 9. Test strategy

### 9.1 What emulation can and can't prove

| Proven by Playwright device emulation | Needs a real device |
|---|---|
| Layout at each width, safe-area paddings (via the `--safe-area-*` override), sheets, drawers, focus and `inert` | The on-screen keyboard, its height, and the bar riding it |
| Taps, `hasTouch`, coarse-pointer CSS, 44 px targets (measured boxes) | IME composition, autocorrect, predictive text, dictation |
| `visualViewport` stubs for keyboard inset math | Native selection handles and the callout |
| Move up/down, row menus, the two-step share UI with `navigator.share` stubbed | The real share sheet and file types |
| Install UI with `beforeinstallprompt` faked | Add to Home Screen, standalone storage isolation, the 7-day cap |
| Durability via `page.close()` timing | Jetsam kills, tab discards, background suspension |
| CPU-throttled perf (CDP, Chromium only) | Real typing latency, memory limits, battery |

### 9.2 Automated (adds to the test strategy's projects)

| Project | Target | Specs | When |
|---|---|---|---|
| **`mobile`** (new, M28) | `next dev` + Hocus; `devices["Pixel 7"]` (Chromium) | library home, drawer, sheets, Move up/down, outline row menu, comment sheet, handoff page phone variant, Send a copy flow, install UI states, `--keyboard-inset` with a stubbed `visualViewport`, safe-area paddings, 44 px target audit (every visible control's box) | every PR (Linux, part of the `chromium` job's runner) |
| **`mobile-webkit`** (new, M28) | same, `devices["iPhone 15"]` (WebKit) | the same specs | nightly (WebKit emulation isn't Safari; it catches engine-level regressions) |
| **`mobile-perf`** (new, M28) | production build, Chromium, 4× CPU, Fast 4G | §6.2 budgets | nightly; PR gate with 1.5× slack for the typing A/B only |
| `toolbar-ladder.spec.ts` | existing | adds 744, 820, 834, 1024, 1032, 1180, 1194, 1366 in both orientations | every PR |
| `pwa` | existing | adds the library origin's manifest and standalone detection | nightly |

`serviceWorkers: "block"` holds for `mobile` and `mobile-webkit` (test strategy §1.2).

**Rule for every touch spec:** after a touch pan or a scroll, wait until the page is at rest (scroll position unchanged across two frames) before tapping. Linux Chromium treats a tap on a coasting page as stopping the scroll, not as a click, as phones do; the continue-chip spec hit exactly this (§1). M28 extracts that wait from `continue-chip.spec.ts` into `tests/e2e/helpers/` and the new specs use it.

### 9.3 Real devices

| Device | Why | Owner |
|---|---|---|
| iPhone SE (3rd gen), iOS 26 | Smallest supported width (375 × 667), no notch, low memory | Device cloud |
| iPhone 15/16/17, iOS 26 | Dynamic Island, the common size (393 px) | Owner's phone **[assumption]** |
| iPhone Pro Max, iOS 26 | Largest width (440 px), landscape | Device cloud |
| iPad (A16 or Air), iPadOS 26, with keyboard and trackpad | Tablet band, hardware keyboard, trackpad hover, free-size windows | Device cloud or owner |
| iPad mini, iPadOS 26 | 744 px portrait: phone bar on a tablet | Device cloud |
| Pixel 8a or 9a, Android 16, Gboard | Reference Chrome Android, Gboard IME | Device cloud |
| Samsung Galaxy A25/A35, Samsung Keyboard and Gboard | Mid-range perf reference, the most common Android keyboard | **Bought** (about US$250) **[estimate]** |
| Moto G (2024) | Low-end check | Device cloud |
| Galaxy Tab S9 FE or Pixel Tablet | Android tablet band | Device cloud |

- **Device cloud:** BrowserStack Live (or an equivalent) for the 8 weeks from Gate 4 to Gate 5, plus 1 week before stable **[price unverified; the owner checks the plan]**. It can't test Add to Home Screen storage over 7 days; that one runs on the owner's iPhone (§9.4 item 3).
- **Phone testers:** the 10 beta testers are desktop testers (D32). Add **3 phone testers** (2 iPhone, 1 Android) for the web library from Gate 4, using the same feedback alias (D31) and a phone section in the weekly check-in.
- **Optional automation on a real Android:** Playwright's experimental `_android` driver can run the `mobile` specs against Chrome on a USB-connected device. Owner's machine only, by hand; never in CI.

### 9.4 The release checklist's phone section (L7, test strategy §5.3)

**When (v8):** at Gate 5 and at each stable promotion only, on real devices (the owner's iPhone, the bought Android, the device cloud). Weekly betas run the automated `mobile` projects, not this list.

1. **Edit:** the §5.8 IME list on one iPhone and one Android (Gboard), with a second client in the same paragraph.
2. **Keyboard:** the bar rides the keyboard in portrait and landscape; rotate mid-typing; the caret stays visible; sheets with fields ride the keyboard.
3. **Storage:** iOS — create in Safari, check the first-run card; install to Home Screen, confirm an empty separate library, import the zip; leave the Home Screen app unopened for 8 days of Safari use and confirm the library is still there (runs across the release week on the owner's iPhone). Android — install, confirm the same library, `persist()` result shown.
4. **Durability:** type, switch apps within 1 s, force-quit the browser from the app switcher, reopen: at most the last second is missing.
5. **Share:** open a share link from Messages/Gmail on both platforms (in-app browser and default browser), Just look, Open in browser, join; Open a link… in the Home Screen app.
6. **Export:** Export all (zip lands in Files/Downloads), Send a copy HTML via the share sheet, Markdown as text, PDF via print; import the zip back.
7. **Touch organise:** Move up/down in the outline and library rows; Move to…; tablet outline drag with long-press; the sandbox tab strip scrolls without dragging.
8. **Comments:** add from the selection cell (phone) and the row (iPad); reply in the bottom sheet with the keyboard up; resolve.
9. **iPad:** hardware keyboard shortcuts, shortcut glyphs appear after ⌘B, trackpad hover shows tooltips, resizing the window across 768 px keeps focus.
10. **Undo gestures:** shake and three-finger swipe undo the last edit (iOS) and never garble the document.
11. **Accessibility:** 200% browser text size and pinch zoom at 375 px; reduced motion; both orientations.

---

## 10. PRs

**Effort** is agent-days of implementation plus review rounds, as in the web library design. All target v1 (Gate 5) unless noted. **Design review** is a merge gate for visible UI (screenshots at 375, 744, 820 and 1180 px, light and dark).

| # | PR | Lens | Depends on | Effort | Exit criteria |
|---|---|---|---|---|---|
| **M18** | **Phone and tablet device spike** (no product code): undo gesture events (§5.9); IME list on Gboard, Samsung and iOS with autocorrect on (§5.8); `autocorrect`/Smart Punctuation inside `code`; `canShare` file-type matrix (HTML, PDF, TXT, MD, ZIP) on iOS 26 and Chrome Android; folder pickers; iPad shortcuts-bar inset; in-app browser user agents and storage; HyperMultimedia and Mermaid toolbars at 375 px; memory with a 1,000-heading document; whether the tab strip drags on swipe. "Switch app within 100 ms, then kill" on iOS and Android (§6.4, v8). Whether deleting the Home Screen app deletes its library (§3.3). Writes `docs/research/<date>-phones-tablets-spike.md`. Runs **before Gate 3** (D36). | QA + SE | none (devices: D36) | S: 2 days + device time | Every **[device]** tag in this document is answered or turned into an issue. |
| **M19** | **Writing on phone keyboards:** prose `autocapitalize="sentences"`, autocorrect on, code and inline code opt out (§5.7); the `historyUndo`/`historyRedo` handler if M18 shows it is needed (§5.9); the composition audit of eager plugins (§5.8). Attributes set by build target, never per render; code opt-outs through `HTMLAttributes`. Editor chunk: D41's lines (≤ 40 B, plus ≤ 80 B only if M18 shows the DOM is mutated). | SE | M18, D41 | S: 1.5 days, 2 rounds | The §5.8 list passes on M18's devices. Ledger within its lines. |
| **M20** | **Keyboard inset store and lifecycle:** `lib/keyboard-inset.ts` with `--keyboard-inset`, sheets ride the keyboard, caret kept in view on orientation change, the hidden-flush test hook (flush without compaction, v8), the awareness rate check (§4.6, §6.4, §6.5). | DE | — | S: 2 days, 2 rounds | `mobile` specs for sheets with a stubbed `visualViewport`; flush starts in the hidden task; no listener left after unmount (leak spec). |
| **M21** | **Library on phones:** list-first home, drawer, document header, FAB, 48 px rows with ⋯ menus, Move to… sheet, Quick Open as a full-screen sheet, the tablet docking rule (§4.2, §4.3, §4.5). **Design review.** | UX + DE | W5, M20 | M: 4 days, 3 rounds | Keyboard checklist still passes; `mobile` specs; screenshots. |
| **M22** | **Touch organise and sections:** outline row ⋯ (Fold, Move up, Move down), outline drag with long-press on visible coarse handles, the in-editor drag handle hidden on coarse, the tab strip's touch activation (check dnd-kit's activation constraint first, else separate mouse and touch sensors, v8), Block in the Aa sheet (E4), fold chevron hit area (§5.2–§5.4). Tablet drag is on D41's cut-first list. **Design review.** | DE + UX | P2.12 (E4), M21 | S–M: 3 days, 2 rounds | Move up/down is one undo step; the tab strip scrolls on swipe; tablet drag works after 250 ms only. |
| **M23** | **Storage and install on phones:** iOS first-run choice card, install steps sheet, Android install row and `persist()` after install, in-app browser banner, phone storage copy (§3). **Design review.** | UX + SE | W6, W4 (library manifest) | S–M: 3 days, 2 rounds | Every §7 storage state has a `mobile` spec and a screenshot; standalone detection covered in `pwa`. |
| **M24** | **Export, import and share sheet on mobile:** two-step Send a copy with `canShare` gating, Markdown as text, Export all download copy, folder import hidden on phones (§3.5). | DE | W7, P2.10 | S: 2 days, 2 rounds | `navigator.share` stubbed specs for every row; M18's matrix decides which rows show Share. |
| **M25** | **Share links on phones:** handoff page platform and in-app variants (no Open in app on iOS, iPadOS, Android; Copy link from memory on iOS, built by S1b's shared `lib/sharing/link.ts`, v8), **Open a link…** in the library (§2, §7). **Design review.** | UX + SE | P4.3, W10 | S: 1.5 days, 2 rounds | Staging e2e: open on an emulated phone, Just look, join, Copy link gives a working link; the secret never reaches storage on Just look; a touchscreen Windows user agent still sees Open in app. |
| **M26** | **Comments and presence on phones and tablets:** thread bottom sheet, 💬 cell swap where `canComment()`, the tablet row Comment button, collapsed avatar row, People sheet (§5.5, §2). **Design review.** | UX + DE | P4.9, P4.11, P4.7, M20 | M: 4 days, 3 rounds | Add, reply, resolve on `mobile`; the comments perf A/B unchanged; sandbox keeps 🖌. |
| **M27** | **Tablets and hardware keyboards:** `pointerType`-keyed hover affordances, shortcut glyphs after the first hardware key press, the iPad widths in `toolbar-ladder.spec.ts`, 744 px phone bar check, 200% text and the `text-scale` measurement (§4.4, §5.10, §8). The hardware-keyboard listener stays out of the editor chunk (D41). | DE | — | S: 2 days, 2 rounds | Ladder passes at every listed width in both orientations; glyphs appear only after a key press. |
| **M28** | **Mobile test ring:** the `mobile`, `mobile-webkit` and `mobile-perf` projects, the target-size audit helper, the §9.4 checklist in the release runbook, a "Phones and tablets" section in `tests/TESTING.md`, and Help › "Using TinyDocy on a phone". | QA | Q7 (projects pattern), M21 | S–M: 3 days, 1–2 rounds | Projects green for 7 nights (test strategy §1.6); budgets in §6.2 recorded on the reference devices. |

**Order:** M18 first (it answers the device questions), then M20 and M27 (no dependencies), then M19, then M21 → M22 and M23/M24 in parallel after the W PRs land, then M25/M26 with Phase 4. **Total:** about 28 agent-days plus device time, all v1 (D36). The owner's time is about 25–35 hours (plan §8.1): five design reviews (M21, M22, M23, M25, M26), the device checks and the iOS storage check in §9.4.

**Cut order if late** (to v1.1): **the plan's D41 order wins** (v8): after the brand design's B8 video and B6 feed, M23's in-app-browser banner (the handoff variant stays), then M27's shortcut glyphs, then M22's tablet drag (the menu stays); then the plan's D30 order. `mobile-webkit` nightly is not on D41's list and is cut only by an amendment. **Never cut:** M18, the M19 autocapitalize change, M20's flush test, M23's iOS first-run card, M25's hidden **Open in app**.

---

## 11. Owner questions (max 3)

> **Answered (plan v8):** MQ1 and MQ2 by **D36** (option a for both: full support, real devices). MQ3 by **D41** (option a, conditional on M18: attributes ≤ 40 B, undo handler ≤ 80 B only if the DOM is mutated).

| # | Question | Options | Recommendation | Blocks |
|---|---|---|---|---|
| **MQ1** | **How do we label phones in v1?** | (a) **Supported** on iOS/iPadOS Safari 26 and Chrome Android, release-gated by §9.4. (b) **Works, best effort**: no gate, a "Phones: best effort" line in the README and Help. (c) Read and comment only on phones; editing hidden below 768 px. | **(a).** Share links will be opened on phones whatever we say, the editing surface already exists and is tested, and (c) removes a feature people use today on the sandbox. | M18 scope, the §9.4 gate |
| **MQ2** | **Real devices** | (a) The owner's iPhone + one bought mid-range Android (~US$250) + a device cloud for the 8 beta weeks + 3 phone testers. (b) Device cloud only. (c) The owner's devices only. | **(a).** The 7-day storage check and long IME sessions need a device you hold; the cloud covers the size and OS spread; testers catch what we don't think of. | M18, M28 |
| **MQ3** | **Bytes for touch writing on the D23 ledger** | (a) Approve a new line of ≤ 120 B gz for M19 (undo-gesture routing, measured by M18, plus the code autocorrect attributes). (b) No new line: ship autocapitalize only, and leave shake-to-undo unhandled. | **(a), conditional on M18** showing that native undo reaches the DOM. If M18 shows nothing is sent, the line shrinks to the attributes alone. | M19 |

---

## 12. Calls made here (check while reading)

- **The 768 px boundary stays** for the phone bar; 640 px is only the comments and Settings sheet boundary (already in those designs). iPad mini portrait gets the phone bar.
- **Width and pointer, never the user agent**, for layout. The **platform** (iOS, iPadOS, Android) gates OS capabilities only: Open in app, folder import, install steps, the handoff page's Copy link. The in-app browser heuristic changes **copy and the primary button** only, never what is possible.
- **Hover affordances key on `pointerType`**, not on `(hover: hover)`.
- **No VirtualKeyboard API, no `interactive-widget` change.** One `visualViewport` path.
- **No drag on phones.** Menus for every move. Tablet outline drag after a 250 ms press.
- **Autocorrect and autocapitalize on for prose**, off in code (fallback: autocapitalize only, if M18 finds corruption).
- **The 🖌 cell becomes 💬** in documents that allow comments.
- **iOS: install first** in the library's first run; Android: an Install row, never an automatic prompt.
- **Export all is a download on phones**; the share sheet is used only where `canShare` says yes, after a Preparing step.
- **Open in app is hidden** on phones and touch tablets; **Open a link…** is added to the library.
- **No Dynamic Type adoption**; `text-scale` only if the ladder passes at 200%.
- **The sidebar docks on library hosts** only when the window fits the sidebar plus the page card.
- **Phones have no palette entry point**; every action is in the bar, the Aa sheet or ⋯.

---

## 13. Sources

Research done 2026-11-16. Secondary sources are marked.

**Apple and WebKit**
- WebKit, Tracking Prevention (the 7-day cap; user interaction is a click, tap or keyboard entry, not scrolling; Home Screen web apps exempt and isolated from Safari). https://webkit.org/tracking-prevention/
- WebKit, "Full Third-Party Cookie Blocking and More" (24 Mar 2020): the 7-day cap on script-writable storage. https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/
- WebKit, "Updates to Storage Policy" (Aug 2023): quotas, eviction, `persist()` heuristics. https://webkit.org/blog/14403/updates-to-storage-policy/
- WebKit, "Web Push for Web Apps on iOS and iPadOS" (Feb 2023, iOS 16.4): Home Screen web apps, manifest `id`, Badging. https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/
- WebKit, "News from WWDC25: WebKit in Safari 26 beta": every site added to the Home Screen opens as a web app. https://webkit.org/?p=16993
- heise, "iOS 26 and iPadOS 26: changed web app behaviour on the home screen" (secondary). https://heise.de/-10749652
- firt.dev, iOS PWA notes (updated Oct 2026; secondary): storage not shared with the browser; iOS 26 default. https://firt.dev/notes/pwa-ios/
- Apple Support 104996: web apps on the Dock share no website data with Safari. https://support.apple.com/en-us/104996
- WebKit Bugzilla 199854: `pagehide` doesn't fire when the WebContent process is killed (jetsam), by design. https://bugs.webkit.org/show_bug.cgi?id=199854
- Apple Developer Forums, `-webkit-touch-callout: none` not working on iOS 26.1. https://developer.apple.com/forums/thread/808606
- Apple Human Interface Guidelines, Accessibility (44 × 44 pt minimum hit target). https://developer.apple.com/design/human-interface-guidelines/accessibility
- MacStories, iOS and iPadOS 26 review, the menu bar and windowing (secondary): Split View and Slide Over replaced by free windows; Stage Manager optional. https://www.macstories.net/stories/ios-and-ipados-26-the-macstories-review/11

**Google, Chrome and Android**
- Chrome for Developers, "Prepare for viewport resize behavior changes coming to Chrome on Android" (`interactive-widget`, `resizes-visual` default). https://developer.chrome.com/blog/viewport-resize-behavior
- MDN, `VirtualKeyboard.overlaysContent` (Chromium only). https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard/overlaysContent
- MDN, Visual Viewport API. https://developer.mozilla.org/en-US/docs/Web/API/Visual_Viewport_API
- Ahmad Shadeed, "The Virtual Keyboard API" (secondary). https://ishadeed.com/article/virtual-keyboard-api/
- Chrome for Developers, "Revisiting Chrome's installability criteria" (no fetch handler needed since Chrome 108 on Android). https://developer.chrome.com/blog/update-install-criteria
- MDN, Making PWAs installable (`beforeinstallprompt`). https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable
- Chrome for Developers, Page Lifecycle API (freeze, discard, `wasDiscarded`; not in Safari). https://developer.chrome.com/docs/web-platform/page-lifecycle-api
- Chrome for Developers, "Respect operating system text scale" (`<meta name="text-scale">`, Chrome 146). https://developer.chrome.com/docs/modern-web-guidance/guides/accessibility/respect-os-text-scale
- Adrian Roselli, "Honoring Mobile OS Text Size" (Feb 2026; secondary). https://adrianroselli.com/2026/02/honoring-mobile-os-text-size.html
- Material Design 3, Accessibility: touch targets 48 × 48 dp. https://m3.material.io/foundations/designing/structure

**Web Share**
- MDN, `Navigator.share()`: shareable file types (no `.zip` or `.md`), transient activation required. https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
- MDN, `Navigator.canShare()`. https://developer.mozilla.org/en-US/docs/Web/API/Navigator/canShare
- web.dev, "Integrate with the OS sharing UI with the Web Share API". https://web.dev/articles/web-share

**ProseMirror, IME and touch**
- prosemirror-view CHANGELOG (Gboard Enter with a bolded suggestion; iOS keyboard state on Enter; Safari composition fixes up to 1.42.8). https://github.com/ProseMirror/prosemirror-view/blob/master/CHANGELOG.md
- ProseMirror forum, "contenteditable on Android is the absolute worst" (Android IME model, duplicated text, `contenteditable=false`). https://discuss.prosemirror.net/t/contenteditable-on-android-is-the-absolute-worst/3810
- ProseMirror forum, "Input error when IME prediction is turned on" (remote updates during composition; y-prosemirror #81; the 5 s Android composition timeout). https://discuss.prosemirror.net/t/input-error-when-ime-prediction-is-turned-on/6515
- ProseMirror forum, "isComposing gets out of sync on iOS". https://discuss.prosemirror.net/t/iscomposing-gets-out-of-sync-on-ios/4067
- ProseMirror forum, "How to disable the mobile Safari selection menu" (`-webkit-touch-callout` doesn't cover selections). https://discuss.prosemirror.net/t/how-to-disable-the-mobile-safari-selection-menu/2581
- dnd-kit, Touch sensor (delay and tolerance activation). https://docs.dndkit.com/api-documentation/sensors/touch

**Accessibility**
- W3C, Understanding SC 2.5.8 Target Size (Minimum), 24 × 24 CSS px. https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
- W3C, Understanding SC 2.5.5 Target Size (Enhanced), 44 × 44 CSS px. https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html
- W3C, Understanding SC 1.3.4 Orientation. https://www.w3.org/WAI/WCAG22/Understanding/orientation.html
- TetraLogical, "Foundations: target sizes" (secondary). https://tetralogical.com/blog/2022/12/20/foundations-target-size/

---

## 14. Amendments to other documents (one docs-only PR, with M18)

> **Plan v8:** applied in the specs: details E14, comments §6.3 (D39), §11.1 and §11.2 (with the 640–767 px sheet), web library W-D7 (host flag), plan §5.4 (handoff page), §8.2 and §8.4b, test strategy §1.2 and §5.3. **Still pending** (for the M18 docs-only PR): UX spec §4.5, onboarding §1.4, web library §3.2, §5.1 and §9. The preferences inventory's H2 row is a research document and was not edited.

| Document | Change |
|---|---|
| Details spec §5, **E14** | Decided: prose autocorrect on and `autocapitalize="sentences"`, code opts out (M19), not a "web follow-up". |
| Preferences inventory, **H2** | Points to this design and M19. |
| Comments design **§6.3** | Adds a row: web library document, comments **On**, as for local desktop documents. |
| Comments design **§11.1 / §11.2** | Phone entry: the 💬 cell replaces 🖌 where `canComment()` is true; tablets: the row's count button becomes Comment with a selection (§5.5 here). |
| Web library design **§3.2, §5.1, §9** | On phones the `This browser` chip is an icon in the header, its popover a sheet; the iOS first-run choice card and the phone storage copy (§3.2, §3.3, §7 here). |
| Web library design **W-D7** ("reuse the desktop library UI unchanged") and UX spec **§4.5** | `components/library/` takes a host flag for the web docking rule (§4.3) and the phone list-first layout (§4.2). Desktop keeps the 720 px overlay rule unless it adopts this one. |
| Plan **§5.4** and **P4.3** | The handoff page hides Open in app on iOS, iPadOS and Android, and offers Copy link on iOS outside the Home Screen app. |
| Test strategy **§1.2** and **§4.4** | Adds the `mobile`, `mobile-webkit` and `mobile-perf` projects and the phone section of the release checklist (§9 here); 3 phone testers join the beta from Gate 4. |
| Plan **§8** PR lists | Adds M18–M28 and the cut order in §10 here. |
| Onboarding design **§1.4** | On iOS in a Safari tab, the choice card sits above the practice-copy link in the library's first run. |
