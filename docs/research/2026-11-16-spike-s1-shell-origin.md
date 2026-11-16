# Spike S1: Electron hosts the static export (origin, CSP, embeds, spellcheck, native feel)

- **Date:** 2026-11-16
- **Plan:** `docs/superpowers/plans/2026-11-16-phase-1-spikes.md`, Task S1
- **Spike branch (never merged):** `spike/s1-shell`, code in `spikes/s1-shell/`, workflow `.github/workflows/spike-s1.yml`
- **Verdict:**
  - **Export and build, and CSP: pass** on macOS, Windows and Linux, on both origins.
    - Export uses the plan's overlay fallback for metadata files.
    - CSP holds with only the pre-registered `style-src-attr` amendment, plus two app changes (no CSP relaxation): Tiptap's injected `<style>` off, and the CSS-inlined icons as files.
  - **Embeds: pass, with the P2.5 X link card required.**
    - YouTube passes on both origins, each with one header fix.
    - X: no X script runs on desktop (X is off, and `widgets.js` is never requested). The kit has no card mode, so the link card is product work, an explicit P2.5 task (coordinator decision, 2026-11-16). There is no waiver of the no-`widgets.js` rule.
  - The Tauri trigger ("embeds fail on both origins") is **not** hit.
  - Rows that need owner hardware are in §3.4.

## 1. Question

Can the Next.js static export run inside Electron from a custom origin with a strict, hash-based CSP and no Node in the renderer? Specifically:
- Do client navigation, icons, fonts, the Hocus WebSocket, YouTube embeds, spellcheck and native menus keep working?
- Which D-A11 origin should we use: `app://tinydocy` or `https://app.tinydocy.invalid`?

## 2. Versions

| Component | Version |
|---|---|
| Electron | 45.3.2 (Chromium 156.0.8078.100, Node 24.22.2) |
| Next.js | 16.4.6 (Turbopack), `output: "export"` |
| Bun | 1.4.4 (`Bun.build` for the CJS main and preload bundles) |
| Playwright | 1.65.0 (`_electron`) |
| macOS runner | `macos-26-arm64` image 20261102.0473.1, macOS 26.7.2 |
| Windows runner | `windows-2025-vs2026` image 20261103.298.1, Windows Server 2025 10.0.26100 |
| Linux runner | `ubuntu-24.04` image 20261111.370.1, Ubuntu 24.04.5, under `xvfb-run -a` |
| Local Mac | Apple M5 Max, macOS 27.0.1 (26A434), unpackaged `electron dist/main.cjs`. Seven other agent sessions were running, with load average 7–14. |

## 3. Results

Workflow runs:
- **Canonical:** [43920568081](https://github.com/docs-plus/editor/actions/runs/43920568081). Both origins plus the controls on all three OSes, with the spike's final code: the isolated embed document, `img-src 'self'` with the icons as files, the Linux dictionary fallbacks and the export listing.
- Earlier runs with the same rows, kept for the record:
  - [43916470123](https://github.com/docs-plus/editor/actions/runs/43916470123): Windows failed only on the `/about` segment-prefetch 404, which led to the `unexpected404` rule.
  - [43917605004](https://github.com/docs-plus/editor/actions/runs/43917605004) and [43919271134](https://github.com/docs-plus/editor/actions/runs/43919271134): on macOS the spellcheck screenshot step timed out once per run, which led to the typed-text check.

"Both" means `app://tinydocy` and `https://app.tinydocy.invalid`.

### 3.1 Gate-blocking rows

| Row | Result | OS / origin | Evidence |
|---|---|---|---|
| **Export and build** | **Pass, using the fallback for metadata files** | all 3 OSes, both | See §3.1.1 |
| **Embeds** | **YouTube: pass** on both origins, each with one header fix. No Error 153 on any OS; playback was confirmed on the Mac. **X: pass, with the P2.5 link card required.** No `widgets.js` runs; the kit can't draw a card yet, so the card is a P2.5 task. | all 3 OSes, both | See §3.1.2 |
| **CSP** | **Pass with the pre-registered amendment** (`style-src-attr 'unsafe-inline'`) and two app changes: Tiptap `injectCSS: false`, and the CSS icons as files. `img-src` stays `'self'`. | all 3 OSes, both | See §3.1.3 |

#### 3.1.1 Export and build

- `bun spikes/s1-shell/build-export.ts` writes `out/` on every OS. `out/` contains no `sitemap`, `robots`, `opengraph-image`, `manifest` or `apple-icon`.
- **Turbopack honours `pageExtensions` for `page.*` and `route.*` files but not for metadata files.** In the web build, `sitemap.web.ts` became the route `/sitemap.web` instead of `/sitemap.xml`. The same happened to `robots.web`, `opengraph-image.web`, `manifest.web` and `apple-icon.web`, from `.next/app-path-routes-manifest.json`.
- So the metadata files keep their plain names, and the desktop build moves them out of `app/` and back afterwards: the "prebuild overlay" fallback (arch §3.1).
  - The web build then has every route: `/sitemap.xml /robots.txt /opengraph-image /manifest.webmanifest /apple-icon /privacy /llms.txt /api/documents/[id] /offline` (`check-web-routes.ts`, Linux job).
  - The move-aside must park the files **inside the checkout**. Windows runners keep the repo on `D:` and the temp dir on `C:`, so `rename` fails with `EXDEV`.
- The CJS bundles from `Bun.build` load with `sandbox: true`. The preload's only `require` is `electron`, and `main.cjs` has no `bun:` imports.
- **Bun inlines `__dirname`** as the absolute source directory: `var __dirname = "/Users/…/spikes/s1-shell"`. That leaks the build machine's path and breaks once packaged. Main finds its siblings through `app.getAppPath()` instead. S2 found the same.

#### 3.1.2 Embeds

**YouTube.** Every cell is the same on macOS, Windows and Linux.

| | Header fix on | Header fix off (control) |
|---|---|---|
| `app://tinydocy` | No Error 153. The Mac played to `currentTime` 6.5 s. | **Error 153** |
| `https://app.tinydocy.invalid` | No Error 153. The Mac played to 7.0 s. | **Error 153** |

- What each fix does:
  - `app://`: `onBeforeSendHeaders` sets `Referer: https://app.tinydocy.invalid/` on YouTube `subFrame` requests that arrive with no Referer or an `app:` one.
  - `https`: in `protocol.handle("https")` the forwarded `Request` carries `referrer` but **no `Referer` header**, so `net.fetch` drops it. Copying `request.referrer` into the header fixes it.
- YouTube checks the Referer header server-side, so `document.referrer` can stay `""` (as it does on `app://`).
- On hosted runners the player loaded with no Error 153 and no bot check, but the video never advanced: `currentTime` stayed 0 after the click. So **playback is confirmed on the Mac only**. Windows and Linux confirm "no Error 153, player loaded", and the controls confirm that the fix is what avoids 153.
- The iframe gets no preload. The preload ran only in the top frame, `app://tinydocy/` or `https://app.tinydocy.invalid/`.
- Screenshots:
  - `spike-evidence/s1/macos-app-youtube-plays.jpg`
  - `macos-app-youtube-153-without-rewrite.jpg`
  - `macos-https-youtube-plays.jpg`
  - `macos-https-youtube-153-without-forward.jpg`

**X.**
- With the kit's default `X` node, the app calls `publish.x.com/oembed` and injects `platform.twitter.com/widgets.js`. Both are blocked by the desktop CSP: one `connect-src` and one `script-src-elem` violation, and the node stays on "Loading embed…".
- With `HyperMultimediaKit.configure({ X: false })` on desktop:
  - zero violations
  - no `widgets.js` in any net-log (`widgetsJsRequested: false` on every OS)
- But the kit has **no link-card rendering**. The Embed dialog still lists X, and a pasted X URL produced no embed and no link mark.
  - Recorded as **pass, with the P2.5 link card required** (coordinator decision, 2026-11-16): the spike confirmed that X's script never runs, and the missing card is product work.
  - Nothing third-party runs, and YouTube works on both origins, so the Tauri condition "embeds fail on both origins" is not hit.

#### 3.1.3 CSP

- Main builds the header per response:
  - `script-src 'self'` plus one SHA-256 per inline script: 10 on `/` and 16 on `/about` in this export, plus the spike's probe script
  - `connect-src 'self' ws://127.0.0.1:1294` (only the default server)
  - `img-src 'self'`
  - YouTube, Vimeo, Loom, SoundCloud and Spotify in `frame-src`, with no X hosts
  - no `'unsafe-inline'` in `script-src` and no `blob:`
- The run: open the app, type, paste formatted HTML (bold, italic, a coloured span, a link and a table), insert a table, and open the toolbar popovers (7 opened).
  - **Strict styles** (`style-src 'self'` plus hashes): 49 to 51 `style-src-attr` violations on the Mac, from ProseMirror and node views setting `style` attributes.
  - **With the pre-registered amendment** (`style-src-elem` hashes and `style-src-attr 'unsafe-inline'`): **0 violations from app code**, on all 3 OSes and both origins.
  - The only remaining violations are `img-src` blocks of the Playground's `picsum.photos` images. That is the intended remote-image behaviour (D10), not app code.
- Two more changes were needed. Both are amendments (§5):
  - **Tiptap's injected `<style data-tiptap-style>`** (1,329 bytes) is blocked by `style-src-elem`. Desktop sets `injectCSS: false` and ships the same CSS as a stylesheet (`styles/_tiptap-core-base.scss` on the spike branch).
  - **Eight CSS-inlined SVG icons** are `data:` URIs (seven unique): heading drag, list checkbox and the phone sheet's kind icons. `img-src` covers CSS backgrounds and masks, so `img-src 'self'` blocks them.
    - The spike moved them into files (`public/spike-icons/`) instead of relaxing the CSP.
    - With `img-src 'self'` alone, the same run shows 0 app violations.

### 3.2 Other rows

| Row | Result | Notes |
|---|---|---|
| Navigation | **Pass** (all 3 OSes, both origins) | Editor → `/about` → editor through the Next router: a JS marker survived and there were 0 `did-navigate` (document) events. |
| Icons and fonts | **Pass**, with one app finding | Inter loads from the origin. The core run's net-log has no `fonts.gstatic.com`. Its only non-loopback hosts are Windows' `wpad` and Linux's Hunspell download (spellcheck row below). The only 404 is **`/privacy`**: a web-only page that the app's footer links to and `/about` prefetches. Desktop needs that link removed or retargeted. On Windows, the export **lacks `/about/__next.about.__PAGE__.txt`**, because Next 16.4.6 writes segment-prefetch files with a directory separator where macOS and Linux use a dot: `out/about/__next.about/__PAGE__.txt` against `out/about/__next.about.__PAGE__.txt` (canonical run, `find out -name '*.txt'`). That costs the segment prefetch only: navigation still fell back to the full payload without a document load. The protocol handler can map the dotted name, or Windows builds can be avoided. |
| Hocus `Origin` | **Pass** | Hocus logged `origin="app://tinydocy"` and `origin="https://app.tinydocy.invalid"`, never `null`, with `HOCUS_ALLOWED_ORIGINS` set to the origin under test only. The socket gate admits a missing `Origin` (`origin && !list.includes(origin)`) but refuses the literal string `"null"`. |
| `/_asset/<hex>` | **Pass** (all 3 OSes, both origins) | The fixture PNG: `200 image/png`, and it renders through `img-src 'self'` (`naturalWidth` 1). A `blob:` image is blocked (1 violation, expected). Eight traversal probes all 404, including `/_asset/../main.cjs`, `/_asset/%2e%2e/main.cjs`, `/_asset/..%2fmain.cjs`, `/..%2fspikes%2fs1-shell%2fmain.ts`, `/%2e%2e/%2e%2e/package.json`, an unknown hex and a non-hex name. |
| Spellcheck, no network | **macOS: pass. Windows: spellcheck makes no request, but the literal measure ("zero non-loopback hosts") fails on `wpad`. Linux: fails, and neither fallback tried fixed it** | **macOS:** native checker, no download events, `mispeled → misspelled`, 0 non-loopback hosts. **Windows:** the Windows spellchecker, no dictionary download; the only non-loopback host is **`wpad`** (Chromium's proxy auto-detect DNS lookup, present in every Windows net-log, not spellcheck). **Linux:** Hunspell downloads `en-US` from `redirector.gvt1.com` / `*.gvt1.com`. **Fallback 1:** a dictionary served from the app origin through `setSpellCheckerDictionaryDownloadURL("app://tinydocy/_dict/")` **fails** (`download-failure`), so the downloader doesn't go through `protocol.handle`. **Fallback 2:** preseeding `en-US-10-1.bdic` (**451,968 bytes**, the exact-case name) into `<userData>/Dictionaries` before start **also fails**: the download still starts and succeeds against `gvt1.com`. The next thing to try (P2.5) is a download URL Chromium will fetch without leaving the machine, a loopback HTTP server in main or a `file://` URL, with the `.bdic` files bundled. The underline shows on all 3 OSes: `spike-evidence/s1/{macos,windows,linux}-spellcheck.png`. |
| Preload and `<html>` attributes | **"The preload wins, through a MutationObserver"** | When the sandboxed preload runs, `document.documentElement` is `null`, so it can't set attributes directly. A `MutationObserver` on `document` that the preload installs sets `data-spike="1"` as the parser inserts `<html>`. The first inline `<head>` script then logged `dataset.spike=1` on all 3 OSes and both origins. |
| Sender check | **Pass** (all 3 OSes, both origins) | Top-frame IPC is accepted. A YouTube subframe in a test window with `nodeIntegrationInSubFrames` is refused (`not_top_frame`). **Node's `new URL("app://tinydocy/").origin` is `"null"`** (non-special scheme), so the check must compare `` `${protocol}//${host}` `` and never `.origin`. |
| Native feel: `registerAccelerator: false` | **Pass:** macOS (runner and local Mac), Windows Server, Linux xvfb | The menu shows ⌘B / Ctrl+B and ⌘Z / Ctrl+Z. OS-level keys (`osascript` System Events, `SendKeys`, `xdotool`) toggled bold exactly once and undid once, with **0 menu clicks**, so nothing ran twice. |
| Native feel: Undo/Redo intents | **Pass** (all 3) | The native menu items' `click` sends `app.menuIntent`; the renderer runs `undo()` / `redo()` (the Yjs undo). Enablement follows `can().undo()` / `can().redo()` over IPC: after a redo, Undo is enabled and Redo is disabled. |

### 3.3 Startup marks (recorded only, arch §10)

`performance.now()` in main, from process start, for an unpackaged, cold, single launch:

| Machine | Origin | `did-finish-load` | First editable document |
|---|---|---|---|
| Local Mac (M5 Max, loaded) | app | 538 ms | 1,030 ms |
| Local Mac | https | 725 ms | 1,269 ms |
| `macos-26` runner | app / https | 6,382 / 939 ms | 9,533 / 1,740 ms (the first Electron launch on a fresh runner) |
| `windows-latest` runner | app / https | 977 / 468 ms | 1,937 / 1,350 ms |
| `ubuntu-24.04` runner (xvfb) | app / https | 443 / 314 ms | 1,007 / 980 ms |

These are not the arch §10 conditions: no packaging, no 1,000-document library, and not an M1. They are context, not a verdict.

### 3.4 Pending owner hardware

| Row | What ran here | What is still owed |
|---|---|---|
| Double-click on the drag region follows `AppleActionOnDoubleClick` (macOS) | Not run: the export has no drag region yet (that comes with the P2.5 title bar) | The owner's Mac after P2.5, or the `systemPreferences.getUserDefault` fallback |
| Snap layouts flyout on the overlay maximise button (real Windows 11 24H2+) | Not testable on Windows Server runners | A real Windows 11 machine. UX fallback if it fails: the native frame. |
| Electron's GTK frame on GNOME Wayland and on KDE | Only xvfb (X11, no window manager) | A GNOME Wayland and a KDE desktop or VM |
| Menu rows on a real desktop session per OS | Ran on hosted runners and the local Mac | Optional confirmation on the owner's machines |

## 4. Evidence

- Results JSON, net-logs, Playwright reports and screenshots per OS and origin are the `spike-s1-<os>` artifacts of the runs above (`retention-days: 90`).
- Screenshots under 200 KB are in `docs/research/spike-evidence/s1/`.
- Inline scripts per page: 10 on `/` and 16 on `/about`. Inline `<style>` elements in the HTML: 0.
- Net-log host lists for the core run:
  - macOS: `[]`
  - Linux: `redirector.gvt1.com` and a `*.gvt1.com` mirror (the Hunspell download)
  - Windows: `["wpad"]`

## 5. Decisions and spec changes

1. **D-A11, the origin: `app://tinydocy` (confirmed 2026-11-16).**
   - Neither origin has zero failed rows, but the rows that fail (the X link card, Linux spellcheck, Windows `wpad`) fail identically on both. Every row that depends on the origin passes on both once its header fix is in, so the plan's "if both pass" tie-break applies.
   - Per the plan's rule, `app://` wins:
     - It doesn't intercept the https scheme. With the https origin, every YouTube, `googlevideo.com` and ad request goes through main's `net.fetch`.
     - Its WebSocket `Origin` is `app://tinydocy`, not `null`.
   - The cost is the `onBeforeSendHeaders` Referer rewrite for YouTube subframe requests. The Referer value (the spike used `https://app.tinydocy.invalid/`) is fixed in P2.5.
   - Amends: arch §1 D-A11, design §4 D-A11 and its §7 "Origin" bullet, image store §3.2 (the asset path rides `app://tinydocy`), and the spikes plan's S4 and S6 origin placeholders.
2. **D-A9 and arch §3.1 step 1:**
   - `pageExtensions` for `page.*` and `route.*` files.
   - A prebuild move-aside, inside the checkout, for `sitemap`, `robots`, `opengraph-image`, `manifest` and `apple-icon`.
   - Classification at branch time:
     - web-only `.web.*`: `page.tsx` (→ `page.web.tsx` plus `page.desktop.tsx`), `privacy/page`, `llms.txt/route`, `api/documents/[id]/route`, `offline/page` and `pwa-icons/[id]/route`
     - as-is: `about/page`
     - `icon.tsx` needs `export const dynamic = "force-static"`
   - `tsconfig.json` must exclude `out/`, because the export copies the service worker's `.ts` source into `out/_next/static/media/`.
3. **Arch §3.1 step 2:** CJS bundles confirmed. Main locates its files through `app.getAppPath()`, never `__dirname`.
**Proposed, not applied in this PR** (this PR amends only D-A11, `pageExtensions` and CJS; these go to P2.5 or a later docs change):

4. **The desktop CSP (design §7):**
   - `script-src 'self'` plus per-response hashes of every inline script, not just the boot script
   - `style-src-elem 'self'` plus hashes, and `style-src-attr 'unsafe-inline'` (the pre-registered amendment)
   - `img-src 'self'`: the CSS icons that are `data:` URIs today move to files
   - Tiptap `injectCSS: false` on desktop
   - `connect-src 'self'` plus the default server
5. **Arch §7, the sender check:** compare `${protocol}//${host}` with the origin. Node reports `.origin` as `"null"` for `app:`.
6. **Preferences §5.3:** the preload applies the boot attributes through a `MutationObserver` on `document`. It can't touch `documentElement` directly, because that is `null` when the preload runs. The hashed inline script stays as the web path and as a no-op check (`data-prefs`).

## 6. Issues for P2.5

The five issue drafts (X link card, Linux Hunspell fetch, `/privacy` 404, `data:` icons, Next Windows prefetch path) are written out in full, ready for `gh issue create`. They are not filed yet: this session's permissions blocked issue creation. The full drafts are in the coordinator's notes; the summary is below.


- X link card for desktop: the kit has no card mode. Also remove X from the desktop Embed dialog's copy.
- Desktop footer: drop or retarget the `/privacy` link, a web-only page.
- Move the eight CSS `data:` SVG icons (`phone.scss`, `list-node.scss`, `heading-drag.scss`) into files, so the desktop CSP keeps `img-src 'self'`.
- Linux spellcheck makes a network request: bundle `.bdic` files (about 450 KB per language) and find a delivery path that works. Two were tried and failed: the app-origin download URL and preseeding `<userData>/Dictionaries`. Next: a loopback HTTP or `file://` download URL. Without one, Linux keeps the download, or spellcheck is off until the user opts in.
- Windows `wpad` lookup: decide whether to keep system proxy auto-detection (corporate proxies need it) or document it as expected traffic.
- Windows export writes segment-prefetch payloads as `__next.<seg>/__PAGE__.txt` instead of `__next.<seg>.__PAGE__.txt`: report it to Next.js. Until it's fixed, build the desktop renderer on macOS or Linux, or have the protocol handler map the dotted name.
- Spike-plan corrections, for whoever runs a spike next:
  - Electron 45 has **no postinstall**: `bun pm trust electron` is a no-op, so run `bun install-electron`.
  - `clipboard.write` now takes `ClipboardItem`s.
  - The plan's literal `grep -nE 'secrets\.|environment:'` matches its own `run:` line. The spike uses bracket expressions; a structural YAML check in `workflow-permissions.test.ts` would be sturdier.
