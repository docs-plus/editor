# TinyDocy desktop: shell and packaging research

Researcher: desktop platform. Date: 2026-11-15. Sources are 2025–2026 unless marked. Claims marked **(unverified)** came from a single secondary source or from memory and need a spike to confirm.

---

## 0. TL;DR

- **Shell:** use **Electron** (current stable is 45, released 2026-10-20). It ships one Chromium engine on all three OSes, the same engine our Playwright suite already tests. ProseMirror and IME behaviour is therefore identical everywhere, and Linux avoids WebKitGTK. The ecosystem is the most mature for signing, auto-update, crash reporting and Linux packages. Comparable editors (AFFiNE, Obsidian, Notion, Linear, Joplin, Standard Notes, Logseq, Anytype) all ship on Electron. AFFiNE and OpenCode moved from Tauri **back** to Electron, citing Chromium consistency.
- **Hosting:** use **`output: 'export'`** in a desktop build target, served from a privileged custom protocol (`app://tinydocy/…`) by `protocol.handle`. An intercepted https origin such as `https://app.tinydocy.invalid` is preferable if the spike confirms YouTube's Error 153 under custom schemes; see §3. The CSP is set as a response header from the main process. Bundling a Next server is not recommended, and a Vite rewrite is not needed. Only two things in the repo block export today: `headers()` in `next.config.ts` and the `DELETE /api/documents/[id]` route handler.
- **Embedded Hocuspocus:** **not in v1.** Local documents persist through a narrow IPC file store in the main process. Sync is the renderer's existing `HocuspocusProvider` talking straight to a remote server. If a local or LAN server is wanted later, run Hocuspocus 4 under Node (`ws` + `node:sqlite`) in an Electron `utilityProcess` instead of shipping a `bun build --compile` binary.
- **Runner-up:** Tauri v2 is smaller, but it uses WKWebView on macOS and WebKitGTK on Linux. Its Chromium (CEF) runtime is still **alpha** (tauri-runtime-cef 3.0.0-alpha.7, 2026-11-06), and tauri-driver cannot test on macOS. **Electrobun** is not ready: a single maintainer who disclaims reviews, a v2 Zig rewrite in Aug 2026, daily betas, and official support for Windows 11+ and Ubuntu 24.04+ only.
- **Distribution, first release:** macOS DMG and ZIP (arm64 and x64, signed and notarized). Windows NSIS (x64, plus arm64 later), signed through Azure Artifact Signing or an OV certificate. Linux: AppImage plus `.deb` (`.rpm` is cheap to add). Updates come from GitHub Releases through `electron-updater`. Flathub follows later; Snap is skipped. Cost is about **$99/yr (Apple) + about $120/yr (Azure Artifact Signing) or about $150–300/yr (OV certificate)**. GitHub Actions is $0 because the repo is public.

---

## 1. Repo fit (what the shell has to host)

Skimmed `package.json`, `next.config.ts`, `app/`, `lib/pwa/`, `lib/offline/`, `scripts/hocus-server.ts`, `lib/security/content-security-policy.ts` and `lib/hocuspocus.ts`.

| Area | Finding | Desktop implication |
|---|---|---|
| Routes | `app/page.tsx` renders `<EditorApp>`, a client app, plus static `/about`, `/privacy` and `/offline`. Metadata routes: `icon.tsx`, `apple-icon.tsx`, `opengraph-image.tsx`, `manifest.ts`, `robots.ts`, `sitemap.ts`. `llms.txt/route.ts` is `force-static`. `pwa-icons/[id]/route.tsx` has `generateStaticParams` + `dynamicParams=false`. | All of these export statically. The app is really a SPA. |
| Server code in Next | `app/api/documents/[id]/route.ts` is a `DELETE` handler using `bun:sqlite`. It is the only API route, called from `lib/tab-api.ts`. | It blocks `output: 'export'`, since route handlers that read `Request` are unsupported. Desktop replaces it with an IPC call (local delete) or a remote HTTP call to the sync server. Exclude it from the desktop build, for example with a `pageExtensions` split such as web-only `*.server.ts` or an env-gated config **(spike: confirm Next 16 honours this cleanly)**. |
| Headers | `next.config.ts` `headers()` sets CSP, `X-Frame-Options`, `Permissions-Policy` and others. | `headers()` is unsupported in export. The desktop main process sets the same headers on every `app://` response, so `frame-ancestors` still works. A `<meta>` CSP can't carry `frame-ancestors`. |
| CSP `connect-src` | Built from `NEXT_PUBLIC_HOCUS_URL` at **build time**. | Users will pick their own sync servers, so the desktop CSP must be computed at **runtime** in the main process from the configured server list (or allow `wss:` broadly). |
| Hocus URL | `lib/hocuspocus.ts` reads `window.__HOCUS_URL` (a test hook) or the build-time env. | It needs a real runtime "server per document" setting exposed from preload. |
| Hocus server | `scripts/hocus-server.ts` uses `Bun.serve`, `Bun.sleep`, `Bun.stdin` and `bun:sqlite` (via `lib/sqlite-open.ts`, `lib/hocus-persistence.ts`, `lib/security/activity-store.ts`). | It can't run in Electron's main or utility process (Node) without an adapter. See §3. |
| Origin gate | Hocus checks `Origin` at upgrade (`HOCUS_ALLOWED_ORIGINS`; prod = `https://tiny.docs.plus`). | Remote servers must allow the desktop origin. That is `app://tinydocy` for Electron; Tauri would be `tauri://localhost` on macOS/Linux and `http(s)://tauri.localhost` on Windows. Document this in the server config tables. |
| Schema gate | `MIN_CLIENT_SCHEMA` refuses outdated clients. | Desktop builds drift more than web tabs, so **auto-update is required for sync to keep working.** Top risk. |
| Offline store | `lib/offline/` keeps IndexedDB copies with 14-day expiry, a 30-doc cap, and keys scoped by epoch and server host. | It is unsuitable as the desktop's primary store, because desktop "local documents" must be durable and unlimited. Use a main-process file store (Yjs state per doc on disk), keeping the same "apply local state before the provider attaches" rule. |
| Service worker | Production-only, network-first HTML and cache-first `/_next/static`. | **Disable it in the desktop build** (`NEXT_PUBLIC_SERVICE_WORKER=0`). The app bundle is already local, and a SW would serve stale chunks after an app update. |
| Test infra | Playwright on Chromium only. | Electron keeps the engine identical to CI. Playwright can also drive Electron (`_electron.launch`, experimental but widely used). |

---

## 2. Candidate shells

### 2.1 Comparison table

| | **Electron 45** | **Tauri 2.12** | **Electrobun 2.0.x** | **Wails v3** | **Neutralino 6.x** | **PWA (baseline)** |
|---|---|---|---|---|---|---|
| Engine, macOS | Bundled Chromium (M156) | WKWebView (system Safari version) | WKWebView, or bundled CEF | WKWebView | WKWebView | User's browser |
| Engine, Windows | Bundled Chromium | WebView2 (Chromium, evergreen) | WebView2, or CEF | WebView2 | WebView2 | User's browser |
| Engine, Linux | Bundled Chromium; Wayland native since E38 | WebKitGTK 4.1 | WebKitGTK 4.1, or CEF | GTK4 + WebKitGTK 6.0 (default since 2026 alphas) | WebKitGTK | User's browser |
| Minimum OS | macOS 12+ (since E38: https://electronjs.org/blog/electron-38-0), Windows 10+ | macOS 10.15+, Windows 10 with WebView2 **(from memory)**, any distro with webkit2gtk-4.1 | **macOS 14+, Windows 11+**, Ubuntu 24.04+ (official) | similar to Tauri | similar to Tauri | any modern browser |
| Main-process runtime | Node 24.22 (no Bun) | Rust (JS only in webview); sidecar for anything else | **Bun** (or Cottontail/Zig/Rust/Go in 2.0) | Go | Native C++ core plus "extensions" as child processes | none |
| Installer size (approx.) | 80–120 MB per arch; Electron-only test app 106 MB | 3–15 MB; minimal test app 1 MB | about 13–14 MB with system webview (mostly Bun); CEF bundles alone 141–178 MB | about 8–15 MB **(unverified)** | about 2–5 MB **(unverified)** | 0 |
| Idle RAM | about 150–300 MB | Windows ≈ Electron (WebView2 is Chromium; one test 142 vs 149 MB); lower on macOS/Linux | not measured publicly | similar to Tauri | similar to Tauri | browser tab |
| Native FS | full Node `fs` in main, exposed through narrow preload IPC | `plugin-fs` with scoped capabilities, or Rust commands | Bun `fs` in main via typed RPC | Go | `filesystem` API (allowlist) | File System Access API (Chromium only) plus OPFS; IndexedDB may be evicted |
| Auto-update | `electron-updater` (NSIS, DMG+ZIP, AppImage, deb, rpm, pacman); blockmap deltas; staged rollout; GitHub/S3/R2/generic | `plugin-updater`, mandatory signatures; NSIS/MSI, `.app.tar.gz`, **AppImage only** on Linux; `latest.json` on GitHub via tauri-action | bsdiff patches (claimed 2–14 KB) from static host via `release.baseUrl` | none built in (v3 has an updater "service" **(unverified)**) | resources-only updater; a core upgrade needs reinstall | automatic (SW) |
| Crash reporting | built-in Crashpad `crashReporter`; `@sentry/electron` (AFFiNE uses it) | Sentry via community plugin **(unverified)**; Rust panics plus webview JS | nothing documented | DIY | DIY | Sentry browser SDK |
| E2E testing | Playwright `_electron` | tauri-driver: Windows/Linux only, **no macOS** (no WKWebView driver) | none documented | none | none | Playwright (existing) |
| Maturity | 2013–, 3 majors supported, 8-week cadence | v2 stable since Oct 2024; v3 alpha (CEF) since Sep 2026 | v1 Feb 2026; v2 (Zig core rewrite) Aug 2026; daily betas | v3 beta Aug 2026; stable unclear | v6.x, small team | n/a |
| Licence | MIT | MIT / Apache-2.0 | MIT | MIT | MIT | — |
| Fit for TinyDocy | **High** | Medium (WebKit risk) | Low today (maturity) | Low (Go, WebKit) | Low | already shipped |

### 2.2 Electron (recommended)

- **Version and cadence.** 45.0.0 stable 2026-10-20 (Chromium M156, Node 24.22), EOL 2027-04-27. 46 is due 2027-01-05. Only the latest three majors get fixes, so plan an upgrade at least every 2–3 releases (about every 4–6 months). Schedule: https://releases.electronjs.org/schedule
- **Linux.** Since Electron 38, `--ozone-platform` defaults to `auto`, so the app runs native Wayland in a Wayland session. https://electronjs.org/blog/electron-38-0, https://electronjs.org/blog/tech-talk-wayland
- **Editor behaviour.** One Chromium build everywhere, the same engine family as our Playwright CI. This matters for the caret and `content-visibility` workarounds in `CaretBlockVisible`, which were tuned for Chromium.
- **Bun fit.**
  - The *shipped* runtime is Node, inside Electron. That is fine: the "Bun only" rule covers our toolchain.
  - `bun install` skips lifecycle scripts unless trusted. Electron's postinstall downloads the binary, so add `electron` to `trustedDependencies` or run `bun pm trust electron`. https://bun.com/docs/pm/lifecycle
  - CI's failing `node` stub: electron-builder or Forge must run as `bun electron-builder` (bunfig `[run] bun = true`). **Spike:** confirm electron-builder 26 and `@electron/notarize` work on the Bun runtime. Fallback is Forge.
- **Packaging tool.** Pick **electron-builder 26 + electron-updater**. It is the most complete single tool for DMG/NSIS/AppImage/deb/rpm plus publishing to GitHub. https://www.electron.build/docs/features/auto-update
  - Forge is Electron-maintained, but its makers don't publish update metadata for electron-updater.
  - AFFiNE uses Forge for makers *and* electron-updater for updates (package.json below), which is more moving parts.
  - electron-builder 27 (ESM, Node ≥22.12) is in alpha.
- **Bundled Node.** The main process can use `node:sqlite`. It has been a release candidate since Node 24.15 and 25.7, with no experimental warning. https://nodejs.org/download/nightly/v27.0.0-nightly20261018f88a1d25e9/docs/api/sqlite.md, https://github.com/nodejs/node/pull/61262 That avoids native-module rebuilds such as better-sqlite3 if we want SQLite locally.

### 2.3 Tauri v2 (runner-up)

- **Version.** Tauri 2.12.3, tauri-cli 2.12.2, updater 2.13.3 (2026-10-10); wry 0.57 (2026-09-08). https://tauri.app/release/
- **Next.js guide** requires `output: 'export'`, `images.unoptimized` and `frontendDist: ../out`; "Tauri doesn't support server-based solutions". https://v2.tauri.app/start/frontend/nextjs/
- **WebKit risk for ProseMirror:**
  - WebKit sends `keydown` after `compositionend` (WebKit bug 165004, still open). https://bugs.webkit.org/show_bug.cgi?id=165004
  - Safari IME breaks in `td`/`th` cells. https://discuss.prosemirror.net/t/ime-composing-problems-on-td-or-th-element-in-safari-browser/4501
  - prosemirror-view 1.41.8 (2026-04-02) added yet another Safari composition workaround. https://cdn.jsdelivr.net/npm/prosemirror-view@1.41.8/CHANGELOG.md
  - BlockNote ships a Tauri-WKWebView-specific IME fix (switches to `plaintext-only` during composition).
  - These are **confirmed on WKWebView (macOS)**. WebKitGTK shares the engine, but these specific IME bugs are **unverified on Linux**. WebKitGTK's documented problems are rendering, repaint and contenteditable focus (below).
- **Linux WebKitGTK quality:**
  - Tauri's own docs page lists GPU/DMABUF problems and recommends `WEBKIT_DISABLE_DMABUF_RENDERER=1`, which costs fast rendering. https://v2.tauri.app/develop/debug/linux-graphics/
  - Repaint and scroll lag issues: tauri#3988, tauri#7021 (WebKitGTK 2.40 regression), https://github.com/xnmp/tauri-explorer/issues/1057
  - A `contenteditable` focus bug. https://github.com/tauri-apps/tauri/discussions/9088
  - Tauri discussion "Webkit is totally unstable" (2024, older). https://github.com/orgs/tauri-apps/discussions/8524
- **CEF escape hatch is alpha.**
  - tauri-runtime-cef 3.0.0-alpha.0 through alpha.7 (2026-09-13 → 2026-11-06). https://crates.io/crates/tauri-runtime-cef/versions, https://v3.tauri.app/develop/cef/
  - Field reports: a Linux main thread pinned at 100% CPU when idle; a CEF 154 packaging break (missing libEGL); a Chromium first-run EULA blocking startup (tauri#15979). https://github.com/arcforgelabs/openclaw/issues/21, https://github.com/tauri-apps/tauri/issues/15979
  - With CEF, Tauri loses its size advantage anyway.
- **Updater.** Signatures are mandatory and can't be disabled, which is good. The Linux updater handles **AppImage only**, so deb/rpm users update through the package manager or re-download. https://v2.tauri.app/plugin/updater/
- **Sidecar pitfall.** Sidecars inherit the app's single entitlements file, and there is no per-sidecar override (tauri#16211). A Bun sidecar needs `allow-jit` (+ `allow-unsigned-executable-memory`). https://github.com/tauri-apps/tauri/issues/16211, https://bun.com/docs/guides/runtime/codesign-macos-executable
- **Testing.** No macOS WebDriver. https://v2.tauri.app/develop/tests/webdriver/
- **CSP.** Tauri rewrites the CSP of bundled HTML (hash/nonce injection, `dangerousDisableAssetCspModification`). With Next's inline `self.__next_f` scripts, an injected hash makes browsers ignore `'unsafe-inline'`. **(Unverified interaction; would need a spike.)**
- **Cost to the team.** Adds a Rust toolchain plus Cargo in CI, which no one on the team uses today.

### 2.4 Electrobun

- **Pros.**
  - The main process is Bun, so in principle `scripts/hocus-server.ts` could run nearly as-is.
  - Small bundles (about 13–14 MB) and tiny bsdiff updates.
  - MIT licence.
- **Releases.**
  - v1 shipped Feb 2026. https://wikidocs.net/blog/@jaehong/8076/, https://news.ycombinator.com/item?id=47069650 (via mirrors)
  - **v2.0 (2026-08-21) moved the core to Zig** and added the Cottontail runtime and Hutch CLI. https://electrobun.dev/blog/electrobun-2-0/
  - Latest stable v2.0.6 (2026-11-04); v2.0.7-beta.23 published 2026-11-15. https://github.com/blackboardsh/electrobun/releases
- **Platforms.** macOS 14+ official, **Windows 11+ x64 official** (arm64 beta), **Ubuntu 24.04+ official**, other distros "community". https://github.com/blackboardsh/electrobun
- **Engines.** System webview (the same WebKit risks as Tauri on macOS/Linux) or `bundleCEF` (+141–178 MB per platform).
- **Governance red flag.** The README says there should be "no expectation that I will review, respond to, or merge" issues and PRs. It is effectively a single maintainer.
- **Bun's role.** The 2.0 post itself says Bun has no LTS to pin, which is why the author built Cottontail. That means the Bun main process is no longer the strategic centre.
- **Signing and crashes.** Signing and notarization for macOS exist in config. Windows signing is inconsistent across sources (third-party skill pages show a `win` cert block, while a Hutch guide says Windows signing isn't in its pipeline). No crash reporter is documented. https://blackboard.sh/electrobun/docs/guides/code-signing
- **Verdict.** Re-evaluate in 6–12 months. Too much churn for a product that must auto-update reliably to pass the schema gate.

### 2.5 Wails v3, Neutralino

- **Wails v3** is Go. It went beta 2026-08-02; a v3.0.0 stable tag is reported but unverified. Linux now defaults to GTK4 + WebKitGTK 6.0. The same WebKit concerns apply, plus a Go backend the team doesn't use. https://docs-preview.wails.io/changelog/, https://newreleases.io/project/github/wailsapp/wails/release/v3.0.0
- **Neutralino** v6.8.0 (2026-06). Its updater only swaps resources, so a core upgrade needs a reinstall, and its native APIs are thin. https://neutralino.js.org/docs/how-to/auto-updater
- **Verdict.** Neither is worth it here.

### 2.6 PWA only (baseline)

- **Already shipped:** install, offline copies and the service worker.
- **Gaps:**
  - No real on-disk file manager. The File System Access API is Chromium-only, and per-handle permissions need re-grants (persistent permissions have existed in Chrome since about v122 **(from memory)**).
  - IndexedDB is best-effort storage unless `navigator.storage.persist()` succeeds, and our cache already caps at 30 docs and 14 days.
  - Firefox desktop doesn't install PWAs.
- **Precedent.** Excalidraw deprecated its Electron app for a PWA because the wrapper added nothing (2020, older). https://web.dev/case-studies/deprecating-excalidraw-electron
- **Our case differs.** Durable local documents and a file manager are the point of the desktop app.
- **Recommendation.** Keep improving the PWA in parallel. It remains the zero-install path and the Chromium e2e target.

---

## 3. Hosting the Next.js App Router app in the shell

### Options

1. **Static export (`output: 'export'`), recommended.**
   - **Supported:** server components run at build time; GET route handlers with `force-static`; `generateStaticParams`; metadata files; client-side navigation.
   - **Unsupported:** route handlers reading `Request`, `headers`/`rewrites`/`redirects`, proxy (middleware), server actions, cookies, ISR, default image loader, intercepting routes, dynamic routes without `generateStaticParams`.
   - Source: https://nextjs.org/docs/app/guides/static-exports (updated 2026-08-09).
   - **TinyDocy needs:**
     - a `desktop` build flavour (env flag) that drops `headers()` and the `api/` route;
     - `NEXT_PUBLIC_SERVICE_WORKER=0`, analytics off;
     - a runtime Hocus URL;
     - `images.unoptimized` if `next/image` is used (not seen in the routes skimmed).
   - **Serve it over a privileged custom scheme, not `file://`.**
     - Absolute `/_next/...` asset URLs break under `file://`, and the origin becomes `null`.
     - Electron's checklist item 18 says to prefer custom protocols, because `file://` pages get extra privileges and can't receive CSP headers.
     - Register `app` with `protocol.registerSchemesAsPrivileged({ standard, secure, supportFetchAPI })`, then map `app://tinydocy/<path>` → `out/<path>` / `<path>.html` / `index.html`, with traversal checks. Every response gets the security headers.
   - **Origin choice affects media embeds. Decide it before v0.**
    - Since late 2025, YouTube embeds fail with **Error 153** when the embedding page sends no valid `Referer`. https://simonwillison.net/2025/Dec/1/youtube-embed-153-error/, https://til.simonwillison.net/youtube/fixing-153-embed
    - Custom schemes (`ionic://`, Tauri's scheme on WKWebView) and `file://` have been reported to send none. One Electron app fixed broken YouTube iframes by moving off `file://`. https://corsproxy.io/blog/fix-youtube-error-150-153-webview/, https://delibera.ethosfera.org/hm/z6Mko5npVz4Bx9Rf4vkRUf2swvb568SDbhLwStaha3HzgrLS/blog/release-2025111
    - X's oEmbed fetch (`publish.x.com`) is also a CORS request that must accept our origin **(unverified)**.
    - **Preferred mitigation:** serve the app from an **https origin** by intercepting a reserved hostname with `protocol.handle('https', …)`, for example `https://app.tinydocy.invalid` (similar to Tauri's `http(s)://tauri.localhost` on Windows). Fallback: rewrite `Referer` for allowlisted frame hosts in `session.webRequest.onBeforeSendHeaders`.
    - **Freeze the origin before the first release.** localStorage and IndexedDB are origin-scoped, so changing it later silently wipes `tinydocy-user`, `tinydocy-ui`, continue positions and offline copies.
    - It is also the value servers add to `HOCUS_ALLOWED_ORIGINS`. Below, `app://tinydocy` stands for "the chosen origin".
  - **Dev loop.** Electron loads `http://localhost:3000` from `next dev` (the existing `make dev`), so Fast Refresh and the `window.__tiptap_editor` test hooks keep working.
2. **Bundle a local Next server (`output: 'standalone'`), not recommended.**
   - It needs a Node (or Bun) server process inside the app, an open localhost port (collisions, other local processes can reach it), slower cold start, and +50–100 MB.
   - Known pitfalls:
     - `next` must be a runtime dependency;
     - `public/` and `.next/static` must be copied manually;
     - blank-window failures when the port doesn't bind;
     - native-module ABI rebuilds.
   - Examples: https://github.com/kirill-konshin/next-electron-rsc (custom protocol, no port), https://github.com/diegosouzapw/OmniRoute/wiki/Electron-Guide
   - Nothing in TinyDocy needs SSR at runtime.
   - Nextron is an older Electron+Next template that uses the Pages Router plus export **(from memory; not re-checked for 2026)**.
3. **Vite SPA shell sharing components, fallback only.** Choose this only if the Next export fights us (for example, Next-specific runtime assumptions inside `components/`). It costs a second build pipeline and a second router, and it diverges from the web app.

### Embedding Hocuspocus (local sync server)

- **Is it needed for v1? No.**
  - Local-only documents need *persistence*, not a server: write Yjs updates to disk via IPC.
  - Collaboration means syncing to a *remote* Hocuspocus, which the renderer's `HocuspocusProvider` already does.
  - A local server adds a listening WebSocket that any website in the user's browser can try to reach. It would need an Origin check, a random per-launch token, a `127.0.0.1` bind and DNS-rebinding defence.
- **If we do it later** (LAN sharing, "host a doc from my laptop"):
  - **Electron:** run Hocuspocus 4 inside `utilityProcess.fork()` (Node, Chromium-services-managed, MessagePort to main). https://www.electronjs.org/docs/latest/api/utility-process
    - Hocuspocus 4 supports Node with `ws`/uWS, Bun, Deno and Workers, and exposes `handleConnection(ws, Request, context)`. https://tiptap.dev/blog/release-notes/hocuspocus-4-stable-release, https://tiptap.dev/docs/hocuspocus/getting-started/upgrade
    - Refactor `scripts/hocus-server.ts` so the transport (`Bun.serve` vs `ws`) and the SQLite driver (`bun:sqlite` vs `node:sqlite`) sit behind small adapters. The guardrails and persistence code is otherwise runtime-neutral.
  - **Compiled Bun sidecar (`bun build --compile`), for Electron via `child_process` or as a Tauri sidecar:**
    - adds about 50–60 MB per arch;
    - needs `allow-jit` + `allow-unsigned-executable-memory` hardened-runtime entitlements to notarize and run (https://github.com/ClementJanssens/konductor/pull/22, https://bun.com/docs/guides/runtime/codesign-macos-executable);
    - can't be a universal macOS binary (per one report);
    - in Tauri, can't get per-sidecar entitlements (tauri#16211).
  - **Precedents:**
    - OpenCode Desktop ran its Bun server as a bundled CLI under Tauri, hit startup and reliability problems (especially on Windows), then moved to Electron and ported the server to run in Electron's Node. https://dev.to/brendonovich/moving-opencode-desktop-to-electron-4hip
    - Anytype ships a Go middleware binary (anytype-heart) spawned from Electron over gRPC, with a stdin-EOF "lifeline" so it dies with the parent. That pattern works but costs a second toolchain. https://cdn.jsdelivr.net/gh/anyproto/anytype-ts@develop/README.md

---

## 4. Distribution

### macOS
- **Apple Developer Program:** **US$99/yr**. Developer ID certificates and notarization are included. https://developer.apple.com/forums/thread/746992
- **Requirements:** a Developer ID Application certificate, hardened runtime, secure timestamp, no `get-task-allow`. Flow: `notarytool submit --wait` then `stapler`. electron-builder does this through `@electron/notarize` with an App Store Connect API key (preferred in CI over an Apple ID + app password).
- **Gatekeeper.** Since macOS Sequoia (2024, older but still current), users can't Control-click past Gatekeeper and must go to System Settings. In practice, notarization is mandatory. https://www.macrumors.com/2024/08/06/macos-sequoia-gatekeeper-security-change/
- **Architecture.** Ship **separate arm64 and x64 DMGs** (smaller downloads), or one universal DMG (about 2× size; simpler links). electron-updater needs the **ZIP** target alongside the DMG for updates.
- **Pitfalls.**
  - Notary queue delays (forum reports of hours).
  - Expired agreements in App Store Connect cause 403 errors.
  - Entitlements needed for JIT in V8: Electron's defaults are fine; a Bun sidecar would need extra ones.

### Windows
- **Azure Artifact Signing** (formerly Trusted Signing).
  - About **$9.99/month** (≈$120/yr, 5,000 signatures).
  - Individuals are eligible in the **US/Canada only**. Organizations in the US, Canada, EU and UK, subject to verification.
  - Billing reportedly starts at account creation even if validation fails.
  - Sources: https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options, https://www.itwriting.com/blog/12462-getting-started-with-azure-artifact-signing.html
  - electron-builder supports it via `azureSignOptions` **(from memory; confirm current key name)**.
- **OV certificate** (DigiCert, Sectigo, SSL.com): about **$150–300/yr**. Keys must live on a hardware token or cloud HSM (CA/B Forum rule since 2023), so in CI use a cloud-signing service (SSL.com eSigner, DigiCert KeyLocker), not a `.pfx`.
- **EV no longer buys instant SmartScreen trust.** Microsoft says EV-signed files now go through the same reputation-building as OV, so don't pay the EV premium for SmartScreen. https://learn.microsoft.com/windows/apps/package-and-deploy/code-signing-options, https://www.todesktop.com/blog/posts/windows-apps-psa-ev-certs-do-not-grant-immediate-reputation-anymore, https://knowledge.digicert.com/alerts/ev-signed-application-showing-microsoft-defender-smartscreen-warnings
- **Plan for SmartScreen warnings on the first releases** and say so on the download page. Reputation builds with download volume on a stable publisher identity.
- **Installer and update.** Use the NSIS target (Squirrel.Windows is not supported by electron-updater). electron-updater verifies the Authenticode signature of updates on Windows.
- **Arm64.** Build on `windows-11-arm` runners (free for public repos). Ship x64 first, arm64 once the pipeline is stable.

### Linux
- **First release: AppImage + `.deb`.** Add `.rpm` if it's nearly free in electron-builder. electron-updater updates AppImage, deb, rpm and pacman; deb/rpm updates go through a privileged install prompt.
- **AppImage pitfalls.**
  - Ubuntu 24.04+ AppArmor restricts unprivileged user namespaces, and the AppImage FUSE mount is `nosuid`, so Electron's sandbox can't start. Users hit "SUID sandbox helper" errors and are tempted to use `--no-sandbox`. https://ubuntu-mate.community/t/noble-numbat-two-appimage-apps-fail-with-sandbox-error/27994, https://forum.cursor.com/t/appimage-run-fails-without-no-sandbox-on-linux/168960
  - Ubuntu 22.04+ needs `libfuse2` **(from memory)**.
  - So make **`.deb` the recommended Ubuntu/Debian download**. The deb can ship an AppArmor profile, as Chrome and VS Code do **(verify)**. Keep AppImage for "other distros".
- **Flathub, second wave.**
  - Use the Electron BaseApp. The sandbox has no host files by default, so the file chooser goes through portals.
  - Flathub builds are rebuilt from source and updated by Flathub, not electron-updater, so the in-app updater must be disabled in that flavour.
  - Good reach on Fedora, Mint and SteamOS. https://docs.flatpak.org/en/latest/electron.html
- **Snap: skip.** Its confinement and store review add work, and Flathub plus deb cover most users.
- **arm64.** `ubuntu-24.04-arm` runners are free for public repos.

### Auto-update hosting
- **GitHub Releases** with electron-builder `publish: github`. electron-builder writes `latest.yml`, `latest-mac.yml` and `latest-linux.yml` (plus `-arm64` variants).
- **Matrix pitfall.** Parallel jobs each upload their own `latest-*.yml`. Build into a **draft** release, then merge and verify metadata in a final job before publishing, especially for macOS x64 and arm64, which share `latest-mac.yml`.
- `stagingPercentage` gives staged rollouts. Roll back by publishing a higher version.
- Optional mirror on Cloudflare R2/S3 later.
- **Fit with the existing release process.** Today's process (`vX.Y.Z` tag on `main` → `release.yml` creates the GitHub release) needs a desktop job added to that workflow, or a separate `desktop-vX.Y.Z` tag if desktop and web release cadences differ.

### CI build matrix (GitHub Actions, public repo → standard runners free)
Runners: https://docs.github.com/en/actions/reference/runners/github-hosted-runners, https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/

| Job | Runner | Output | Secrets |
|---|---|---|---|
| mac-arm64 | `macos-15` (arm64) | DMG + ZIP (arm64) | Apple cert .p12, App Store Connect API key |
| mac-x64 | `macos-15-intel` (or cross-build on arm64) | DMG + ZIP (x64) | same |
| win-x64 | `windows-latest` | NSIS | Azure Artifact Signing service principal / OV cloud-sign creds |
| win-arm64 | `windows-11-arm` | NSIS | same |
| linux-x64 | `ubuntu-24.04` | AppImage, deb, rpm | none (optionally GPG for repo) |
| linux-arm64 | `ubuntu-24.04-arm` | AppImage, deb, rpm | none |
| publish | ubuntu | merges `latest*.yml`, un-drafts release | `GITHUB_TOKEN` with `contents: write` (this job only) |

**CI pitfalls specific to this repo:**
- `tests/unit/ci/workflow-permissions.test.ts` requires SHA-pinned actions, read-only permissions and `persist-credentials: false`. The publish job needs an explicit narrow `contents: write`.
- The failing `node` stub on PATH: electron-builder must run on Bun (`bun electron-builder`), otherwise the stub must be scoped away from desktop jobs. **Spike this first.**
- Signing secrets must be available only on tag builds, never on PR builds from forks.
- Smoke-test the packaged app per OS: launch it, open a doc, quit. Use Playwright `_electron` on x64 runners.

### Rough costs
| Item | Cost |
|---|---|
| Apple Developer Program | $99/yr |
| Windows signing | ≈$120/yr (Azure Artifact Signing, if eligible) **or** $150–300/yr OV + cloud signing fee |
| Linux | $0 |
| GitHub Actions + Releases hosting | $0 (public repo; standard runners) |
| Crash reporting | $0 with self-hosted or Sentry free tier (opt-in only, matching the analytics stance) |
| **Total** | **≈ $220/yr if Azure Artifact Signing eligibility holds (a US/Canada individual or a verified US/CA/EU/UK organization); otherwise ≈ $250–450/yr (OV certificate + cloud-signing fee)** |

---

## 5. Security hardening (Electron)

Based on the Electron checklist (https://www.electronjs.org/docs/latest/tutorial/security) and the OWASP Desktop App Security Top 10 (2021, older but still the relevant OWASP list).

1. **Renderer settings.** `contextIsolation: true`, `sandbox: true` (the default since E20), `nodeIntegration: false`, `webSecurity: true`, no `allowRunningInsecureContent`, no experimental or Blink features, `webviewTag: false`.
2. **Preload API.** Expose one minimal, typed `contextBridge` API with named methods only, for example `docs.list/open/save/delete/rename`, `sync.setServer`, `app.version`. Never pass through `ipcRenderer` or raw paths.
3. **IPC validation.**
   - Validate the sender in every `ipcMain.handle`: `event.senderFrame.url` must start with `app://tinydocy/`.
   - Validate payloads with schemas. Document IDs map to files under `app.getPath('userData')/documents/` with traversal checks.
   - User-chosen paths only come from `dialog.showOpenDialog/showSaveDialog` in main.
4. **Custom protocol and CSP.**
   - Use `app://` (checklist #18).
   - The CSP header comes from main and is derived from today's `buildContentSecurityPolicy`, with a runtime `connect-src` for configured sync servers.
   - Drop `'unsafe-eval'`. Consider dropping `'unsafe-inline'` for scripts if the export permits hashes.
   - Keep `frame-src` limited to the media-embed allowlist.
5. **Navigation and windows.**
   - `will-navigate` and `will-redirect`: block anything not on `app://tinydocy`.
   - `setWindowOpenHandler`: deny, and send `http(s):` links to `shell.openExternal` only after URL validation (checklist #13–15). Documents contain hyperlinks from collaborators, so treat them as untrusted.
6. **Permissions.** `session.setPermissionRequestHandler` and `setPermissionCheckHandler` deny by default (camera, mic, geolocation, notifications unless needed), mirroring the web `Permissions-Policy`.
7. **Fuses** (`@electron/fuses`):
   - `RunAsNode` off;
   - `EnableNodeOptionsEnvironmentVariable` off;
   - `EnableNodeCliInspectArguments` off;
   - `EnableEmbeddedAsarIntegrityValidation` on;
   - `OnlyLoadAppFromAsar` on;
   - `EnableCookieEncryption` on.
8. **Updates.** Use signed, HTTPS-only updates (electron-updater checks the code signature on macOS and Windows). Stay on a supported Electron major (checklist #16).
9. **Untrusted sync servers.** A server can push arbitrary Yjs content, the same XSS surface as the web app (Mermaid is already sanitized with DOMPurify, and code-block languages are validated). In desktop, renderer XSS reaches the preload API, so the IPC surface must stay narrow, and destructive actions such as file delete should confirm in main-owned UI.
10. **Local server (only if one is added later).** Bind `127.0.0.1`, require a random per-launch token, check `Origin` strictly, and defend against DNS rebinding (check the `Host` header).

For comparison, Tauri's model is stronger by default: capabilities, permissions and scopes per window, mandatory updater signatures, and an optional isolation pattern. https://v2.tauri.app/security/, https://v2.tauri.app/security/capabilities/ Electron reaches parity only through the discipline above.

---

## 6. What comparable editors chose

| App | Shell | Notes / source |
|---|---|---|
| **AFFiNE** (BlockSuite editor, Yjs) | **Electron 43** with Forge makers (deb, dmg, flatpak, squirrel, zip, AppImage), `electron-updater`, `@sentry/electron`, `@electron/notarize` | Tried Tauri early, then returned to Electron (plugin maturity, debugging, Chromium consistency). https://raw.githubusercontent.com/toeverything/AFFiNE/canary/packages/frontend/apps/electron/package.json, https://codenote.net/en/posts/famous-electron-apps-2026-research/ |
| **AppFlowy** | Flutter UI + Rust core | Not a web-tech shell **(from memory; repo `AppFlowy-IO/AppFlowy`)**. |
| **Obsidian** | Electron (1.12.7 on Electron 39.8, Mar 2026) | codenote audit |
| **Logseq** | Electron **(from memory; DB version in beta)** | https://github.com/logseq/logseq |
| **Anytype** | Electron + Go middleware binary (anytype-heart) over gRPC | Sidecar pattern with a stdin "lifeline". https://cdn.jsdelivr.net/gh/anyproto/anytype-ts@develop/README.md |
| **Notion** | Electron; about 518 MB Mac app | https://daringfireball.net/2026/07/claudes_criminally_bad_mac_app_is_an_inside_job |
| **Linear** | Electron (39.3) | https://desktopinsights.com/apps/linear |
| **Excalidraw** | Deprecated Electron, PWA only (2020) | https://web.dev/case-studies/deprecating-excalidraw-electron |
| **Joplin** | Electron 40.9 | codenote audit |
| **Standard Notes** | Electron | codenote audit |
| **Outline** | Web app; no first-party desktop shell found **(unverified)** | — |
| **OpenCode Desktop** | Tauri → **Electron** (Apr 2026) | WebKit slower than Chromium on macOS/Linux, plus style inconsistencies; the Bun sidecar was unreliable. https://dev.to/brendonovich/moving-opencode-desktop-to-electron-4hip |

Pattern: every collaborative or block editor in this list that ships a web-tech desktop app uses Electron. The teams that tried Tauri left over WebKit consistency, which is exactly the risk for a ProseMirror editor.

---

## 7. Top risks

1. **Schema-gate lockout.** Outdated desktop builds get refused by `MIN_CLIENT_SCHEMA`. Mitigations: auto-update from day one, an in-app "update required to sync" state (the local doc stays editable), and a compatibility window on the server.
2. **Bun-only toolchain vs. Electron tooling.** electron-builder, notarize and the postinstall binary download haven't been verified on the Bun runtime, and CI has the `node` stub. Spike in week 1. The fallback is Forge.
3. **Static export and app origin.**
   - Work: exclude the API route, move headers into main, add a runtime Hocus URL, disable the SW, and find any hidden server-only imports.
   - **The origin choice**: a custom scheme can break YouTube embeds (Error 153, no Referer) and possibly X oEmbed CORS. It also can't change after release without wiping local storage.
   - Spike: build `out/`, load it from the chosen origin, and check that a YouTube and an X embed render.
4. **Origin allow-list on servers.** Collaboration fails silently unless servers add `app://tinydocy` to `HOCUS_ALLOWED_ORIGINS`. Document it and surface a clear error.
5. **Windows SmartScreen** warnings on early releases regardless of certificate type, plus signing eligibility (Azure needs a US/CA individual or a verified organization).
6. **Linux AppImage sandbox** on Ubuntu 24.04+. Lead with `.deb`.
7. **Electron upgrade treadmill.** 8-week majors with 3 supported, about 100 MB downloads per release. Blockmap deltas soften this.
8. **Durable local store.** A new main-process persistence layer (file layout, atomic writes, backup/export) is the real engineering cost. It is shell-independent, but the IPC design must keep the renderer untrusted.

---

## 8. Recommended plan (shell-specific parts)

1. **Week 1 spikes.**
   - (a) `next build` with a desktop flavour → `out/` loads in Electron 45 via `app://`, with the editor working offline.
   - (b) `bun electron-builder` produces signed artifacts on the macOS runner.
   - (c) Playwright `_electron` opens the packaged app.
2. **Main-process modules:** protocol and CSP, window plus navigation guards, document store (IPC), settings (sync server per document), updater, opt-in crash reporter.
3. **Release v0 (internal):** macOS arm64 + x64, Windows x64, Linux x64 AppImage + deb, unsigned Linux and signed macOS/Windows, GitHub Releases plus electron-updater.
4. **Public v1:** add Windows arm64 and Linux arm64, rpm, staged rollout, `CHANGELOG.md` "Deploy" note, and server docs for the `HOCUS_ALLOWED_ORIGINS` desktop origin.
5. **Later:** Flathub; an optional local or LAN Hocuspocus in `utilityProcess`; revisit Tauri 3 (CEF) or Electrobun once stable if download size becomes a complaint.
