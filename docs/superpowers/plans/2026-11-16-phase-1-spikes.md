# Phase 1 Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Test the five riskiest desktop assumptions (spikes S1 to S5 in plan §8.4, Phase 1) against real software on real OSes. Each one runs within a time box and ends in a written pass or fail with evidence. The results settle the open architecture decisions: D-A1 (storage worker or main thread), D-A11 (origin), the CJS/`pageExtensions` build choices (D-A9, arch §3.1), `bun electron-builder` (arch §3.1 step 3) and the S3 update-channel mapping. They also tell us whether to stay on Electron or reopen Tauri, so that Gate 1 can be signed off.

**Architecture:** Spike code is throwaway. Each spike lives on its own `spike/<name>` branch in this repository, under `spikes/<name>/`, and is **never merged to `main`**. Its CI is a `spike-<name>.yml` workflow that runs on `push` to that branch; write-ups link the workflow run URLs (no spike PRs are opened). We use this repo rather than a scratch repo because S1, S4 and S5 need the real app, its static export, `tests/e2e/helpers/perf-observer.ts` and the Node-stub CI. Branches may merge into each other: S4 and S5 branch from `spike/s1-shell`, S5 also merges `spike/s2-storage`, S3 merges `spike/s1-shell` once the export packages, and S4 merges `main` after P1.1 lands. Only three things reach `main`:
- **Task S6:** the D-A12 smoke, the one production-quality PR (test strategy §6.1: "only the D-A12 smoke and the S4 spec survive into `electron`").
- **The write-ups:** one docs PR.
- **The decided amendments** to the plan and the architecture, in that same docs PR.

The S4 spec is copied as a reference into the write-up's appendix. P2.5 adopts it.

**Tech Stack:**
- Electron 45 (Chromium M156), pinned to an exact patch at least 3 days old (`minimumReleaseAge`).
- Electron's bundled Node and `node:sqlite`.
- electron-builder ≥ 26.2.0 (the first that compiles `.icon`; S3 records the exact version) and electron-updater.
- Playwright `_electron`, from the root `@playwright/test` ^1.65.0; Chrome for Testing 156 for S5's `chrome` arms.
- Next.js 16.4.6 `output: "export"`.
- Bun 1.4.4. `Bun.build` produces the CJS main, worker and preload bundles.
- GitHub-hosted runners `macos-26` and `macos-26-intel` (GA 2026-02-26, Xcode 26 by default), `windows-latest`, `windows-11-arm`, `ubuntu-24.04` and `ubuntu-24.04-arm`, plus the owner's real machines.

**Spec:**
- `docs/superpowers/specs/2026-11-15-desktop-local-first-design.md`: §4 D-A1, D-A11, D-A12; §7; §8.3; §8.4 Phase 1; §11 K8, K11; §13 D24, D35.
- `docs/superpowers/specs/2026-11-15-desktop-architecture.md`: §1, §3.1, §5.2, §5.4, §7, §10.
- `docs/superpowers/specs/2026-11-15-desktop-ux-design.md` §14.
- `docs/superpowers/specs/2026-11-16-preferences-design.md` §5.3.
- `docs/superpowers/specs/2026-11-16-test-release-strategy.md`: §1.4, §2.2–§2.4, §4.1, §6.1.
- `docs/superpowers/specs/2026-11-16-brand-icon-website-design.md`: §3, §4.3, §6.
- `docs/research/2026-11-15-desktop-shell-and-packaging.md`: §2.2, §3, §4.

## Global Constraints (apply to every spike)

- Bundles: `bun init -y` writes `"type": "module"`, so every main, worker and preload bundle is emitted as `.cjs` (`--entry-naming '[name].cjs'`), and Electron's `main` points at `dist/main.cjs`.
- Bun only: `bun <bin>` for local bins, `bunx --bun` for remote ones; never `npm`, `npx`, `yarn` or `pnpm`. A nested install doesn't read the root `bunfig.toml`, so each `spikes/<name>/` (and `desktop/smoke/`) gets its `[install]` and `[run]` sections, not `[test]`: `sed '/^\[test\]/,$d' bunfig.toml > <dir>/bunfig.toml`.
- Add `electron` to `trustedDependencies` (`bun pm trust electron`). Its postinstall downloads the binary.
- CI puts the failing `node` stub on PATH after install. The existing "Block Node.js" step from `ci.yml` is copied verbatim.
- Every Linux job (spike workflows and `desktop-smoke.yml`) adds, before Electron launches:
  ```yaml
  - name: Allow the Chromium sandbox (electron/electron#42510)
    if: runner.os == 'Linux'
    run: sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
  ```
- Workflow rules: a read-only top-level token with explicit per-job permissions, `persist-credentials: false`, and actions pinned to commit SHAs. Otherwise `tests/unit/ci/workflow-permissions.test.ts` fails on the branch.
- Secrets (the repo is public): signing credentials live only as GitHub environment secrets with a `main`/`v*`-tag branch policy and a required reviewer. Spike workflows contain no `secrets.` and no `environment:`, grep-checked in the spike's own check step against its own file only (`! grep -nE 'secrets\.|environment:' .github/workflows/spike-<name>.yml`; `deploy.yml` legitimately has both). Signing runs only on the owner's machine, or is "checked at Gate 3 instead" (plan S3).
- Sandbox and context isolation are on, and the renderer has no Node. The preload is CJS ("a sandboxed preload must be CJS").
- Never test against tiny.docs.plus. Every server is a loopback `bun run hocus` with a temp `DB_PATH` and `HOCUS_THROTTLE=0`.
- Commits to `main` (S6 and the docs PR): Conventional Commits in the imperative, no trailers of any kind, and a commit review report the owner approves before each commit. Spike-branch commits use `chore(spike-sN): …`.

## Gate-blocking rows

Gate-blocking rows: export + CSP, embeds, durability (crash atomicity + pragma/fullfsync evidence), `bun electron-builder`, N-1→N updates on Windows and Linux (Linux = AppImage; the `.deb` is owner-checked). All other rows feed P2.5 with their stated fallback. A non-blocking row with no fallback of its own opens a P2.5 issue from its write-up.

## Review Focus (risks no pass row states outright)

1. **Crash atomicity passing without durability.** Pinned to S2's `synchronous=OFF` control and durability-evidence rows.
2. **Main-thread stalls missed by renderer-side timing.** Pinned to S5's commit-arm row.
3. **A 10% verdict inside run-to-run noise.** Pinned to S5's noise floor (`chrome-control`).

---

### Task S1: Electron hosts the static export (origin, CSP, embeds, spellcheck, native feel)

**Time box:** 3 agent-days, plus about 2 owner-hours on real machines. If the time runs out with a check unresolved, that check is marked failed, with what was tried.

**Where:**
- Branch: `spike/s1-shell` from `main`.
- Code: `spikes/s1-shell/`, holding `main.ts`, `preload.ts`, `build.ts`, `csp.ts`, `menu.ts` and `package.json`.
- On-branch hacks to the app:
  - `next.config.ts`: `output: "export"`, `headers()` removed, and `pageExtensions` switched on `NEXT_PUBLIC_APP_TARGET`. Web: `["web.tsx", "web.ts", "tsx", "ts"]`. Desktop: `["desktop.tsx", "tsx", "ts"]`.
  - Route renames (arch §3): list every route file at branch time with `find app -type f \( -name '*.ts' -o -name '*.tsx' \) | sort` and classify each one. Web-only routes (API, SEO, OG, privacy and the like) are renamed to `.web.*`; `app/page.tsx` is also copied as `app/page.desktop.tsx`. For every other dynamic route, record what it needs under export: as-is, `generateStaticParams`, or `.web.*`.
- Workflow: `.github/workflows/spike-s1.yml`.

**Setup:**
```bash
git switch -c spike/s1-shell main
mkdir -p spikes/s1-shell && sed '/^\[test\]/,$d' bunfig.toml > spikes/s1-shell/bunfig.toml
cd spikes/s1-shell && bun init -y && bun add -d electron@45.<x>.<y> && bun pm trust electron
cd ../.. && NEXT_PUBLIC_APP_TARGET=desktop NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1234 bun next build
bun build spikes/s1-shell/main.ts spikes/s1-shell/preload.ts --target=node --format=cjs --external electron --entry-naming '[name].cjs' --outdir spikes/s1-shell/dist
DB_PATH=$(mktemp -d)/s1.sqlite HOCUS_THROTTLE=0 HOCUS_ALLOWED_ORIGINS=<origin under test> bun run hocus &
cd spikes/s1-shell && SPIKE_ORIGIN=app bun electron dist/main.cjs   # then SPIKE_ORIGIN=https
```

`SPIKE_ORIGIN` switches between the two D-A11 candidates inside one `main.ts`:
- **`app`:** `app://tinydocy`. `protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true } }])`, plus a Referer rewrite for the YouTube hosts in `MEDIA_FRAME_HOSTS` in `session.webRequest.onBeforeSendHeaders`.
- **`https`:** `https://app.tinydocy.invalid` (the research example). `protocol.handle("https")` for that host only, and `net.fetch(req, { bypassCustomProtocolHandlers: true })` for every other host.

**Pass criteria.** Each check runs on both origins unless it says otherwise.

- [ ] **Export and build.** *(gate-blocking)*
  - `bun next build` with the hacks writes `out/`.
  - Turbopack honours `pageExtensions` for `sitemap`, `robots` and `opengraph-image`: `out/` contains none of them in the desktop build, and the web build still contains all three. If not, the finding is "fallback: prebuild overlay" (arch §3.1).
  - `Bun.build` CJS bundles for main and preload load in Electron with `sandbox: true`.
  - Measure: `ls out/`, a `bun next build` of the web target, the Electron console.
- [ ] **Navigation, icons and the server.**
  - The editor loads from the origin. Client navigation (editor ↔ `/about`) happens without a new document request (net-log).
  - Every icon and font loads from the origin with no 404, and Inter makes no network request.
  - The Hocus upgrade receives `Origin` equal to the origin string, not `null`, so `HOCUS_ALLOWED_ORIGINS` works. Measure: log the header in Hocus.
- [ ] **Embeds.** *(gate-blocking)*
  - A YouTube embed plays, with no Error 153, and the iframe gets no preload.
  - X shows as a link card, and no `widgets.js` request appears in the net-log.
  - Evidence: a screenshot per origin.
- [ ] **CSP.** *(gate-blocking)* Main builds the CSP as a response header: no `'unsafe-inline'`; the boot script is allowed by its SHA-256 hash; images come from `/_asset/<hex>` on the app origin, with no `blob:`; no X script hosts; `connect-src` lists only the default server.
  - Every inline script in each HTML file is allowed by a SHA-256 hash that main computes per response. Record the number of inline scripts per page.
  - The console shows zero `securitypolicyviolation` events while you open the app, type, paste formatted text, insert a table and open the toolbar popovers. Measure: a `document.addEventListener("securitypolicyviolation")` counter read by `_electron` `evaluate`.
  - Pre-registered likely amendment: ProseMirror sets `style` through `setAttribute`, so `style-src` probably needs `style-src-elem` hashes plus `style-src-attr 'unsafe-inline'`. If that is what passes, it goes to the docs PR as a spec amendment; S1 doesn't relax anything else.
- [ ] **`/_asset/<hex>`.** The route serves a fixture PNG from a temp `assets/` directory on the chosen origin, through `img-src 'self'` and with no `blob:`. Path traversal (`/_asset/../main.js`, `%2e%2e`) gets 404.
- [ ] **Spellcheck makes no network request** on macOS, Windows and Linux.
  - Measure: run Electron with `--log-net-log=<file>`, type a misspelt word, then list the hosts in the log. Zero non-loopback hosts may appear apart from the YouTube test document.
  - The red underline still appears. Evidence: a screenshot per OS.
  - If dictionaries download, retest with the dictionaries bundled and `session.setSpellCheckerDictionaryDownloadURL("<origin>/_dict/")`, and record the size added per language.
- [ ] **The preload and `<html>` attributes.** Find out whether the sandboxed preload can set `<html>` attributes before first paint (preferences §5.3).
  - The preload sets `data-spike="1"` on `document.documentElement`.
  - The first inline script in `<head>` logs `document.documentElement.dataset.spike`.
  - The result is either "preload wins" or "the hashed boot script must do it".
- [ ] **The sender check.** `event.senderFrame.url` parses to the chosen origin for top-frame IPC, and a call from the YouTube iframe is refused (arch §7).
- [ ] **Native feel (UX §14), each on the OSes listed.**
  - With `registerAccelerator: false`, the menu shows the combo and leaves the key to the renderer: macOS, Windows, Linux.
  - Edit › Undo and Redo, sent as menu intents, run the Yjs undo. They have native enablement, or enablement is driven by `can().undo()`: all OSes.
  - No action runs twice when a key is both a menu accelerator and a keymap binding: all OSes. Measure: a counter on ⌘B / Ctrl+B and ⌘Z / Ctrl+Z.
  - Double-click on the drag region follows `AppleActionOnDoubleClick`: macOS.
  - The snap layouts flyout appears on hovering the overlay maximise button: a **real** Windows 11 24H2+ machine.
  - Electron's GTK frame works on GNOME Wayland and on KDE.
- **Deferred to P2.5 (can't change Gate 1):** native scrollbars, `prefers-contrast: more` and forced colours, OS text size, and `accent-color-changed` / `getAccentColor`.

**Runners:**
- `ubuntu-24.04` under `xvfb-run -a` handles the export, CSP, asset route, the Linux spellcheck net-log and the sender check.
- `macos-26` and `windows-latest` handle the same automated checks.
- Native-feel rows, snap layouts and GNOME Wayland/KDE run on real machines (owner prerequisites).

**Evidence:**
- net-logs (host lists), a CSP violation count, the inline-script count
- screenshots: YouTube on both origins, spellcheck on 3 OSes, snap layouts
- the menu double-fire log
- startup marks, recorded only (arch §10): first editable document, cold, against ≤ 1.2 s on Mac and ≤ 2.0 s on Windows
- workflow run URLs

Artifacts use `retention-days: 90`. Screenshots under 200 KB go to `docs/research/spike-evidence/s1/`.

**Write-up:** `docs/research/2026-11-<dd>-spike-s1-shell-origin.md`.

**Feeds:**
- **D-A11:** pick the origin with zero failed rows. If both pass, recommend `app://tinydocy`, because it doesn't intercept the https scheme that every request uses, unless its WebSocket `Origin` is `null`. The owner confirms.
- D-A9: `pageExtensions` or the overlay; CJS bundles.
- The preferences §5.3 boot path.
- UX fallbacks: native frame if snap layouts fail; the `getUserDefault` double-click fallback.
- K11.
- **If the export can't run under the CSP (with at most the pre-registered amendment), or embeds fail on both origins: Tauri revisit (plan §8.4).**

### Task S2: `node:sqlite` storage worker, crash atomicity, durability evidence

**Time box:** 3 agent-days (the latency arms run inside S5's harness, Task S5).

**Where:**
- Branch: `spike/s2-storage` from `main`.
- Code: `spikes/s2-storage/`, holding:
  - `main.ts`: the modes `pragmas`, `churn`, `verify`, `commit-loop`; `--synchronous=FULL|OFF`
  - `worker.ts`
  - `engine.ts`: `docs`, `snapshots`, `updates(doc_id, seq, origin, data)`
  - `kill-harness.ts`
  - `bunfig.toml` and `package.json` (`electron`, plus `yjs` at the root's version)
- Workflow: `.github/workflows/spike-s2.yml`.

**Setup:**
```bash
git switch -c spike/s2-storage main
mkdir -p spikes/s2-storage && sed '/^\[test\]/,$d' bunfig.toml > spikes/s2-storage/bunfig.toml && cd spikes/s2-storage
bun init -y && bun add -d electron@45.<x>.<y> yjs@13.6.33 && bun pm trust electron
bun build main.ts worker.ts --target=node --format=cjs --external electron --entry-naming '[name].cjs' --outdir dist
bun electron dist/main.cjs --mode=pragmas --db "$RUNNER_TEMP/s2.sqlite"
bun kill-harness.ts --kills 200 --target append    # then --target compaction, then --target append --synchronous=OFF
```

On `ubuntu-24.04` both commands run under `xvfb-run -a` (Electron exits without a display); the spawned Electron inherits `DISPLAY`, so SIGKILL still reaches the real pid.

The kill harness launches Electron with `Bun.spawn([require('electron') as string, 'dist/main.cjs', …])`, never `bun electron`: the `electron` bin is a wrapper that doesn't forward SIGKILL to the real process. After each kill it awaits `proc.exited` and asserts the pid is gone (`process.kill(pid, 0)` throws `ESRCH`; `tasklist /FI "PID eq <pid>"` on Windows) before reopening the database.

**Pass criteria.** Rows run on `macos-26`, `windows-latest` and `ubuntu-24.04`. `macos-26-intel`, `windows-11-arm`, `ubuntu-24.04-arm` and every hosted-runner commit-time table are informational only.

- [ ] **The worker opens the library.**
  - `require("node:sqlite")` loads inside a `worker_thread` in main.
  - The pragmas (WAL, `synchronous=FULL`, `fullfsync` on macOS) read back as `journal_mode` = `wal`, `synchronous` = `2`, and on macOS `fullfsync` = `1` and `checkpoint_fullfsync` = `1`.
  - Measure: the stdout JSON per runner.
- [ ] **Appends and compaction work.**
  - An append batch is one transaction (batches go out 250 ms after the last edit, at most 1 s after the first).
  - A renderer-driven compaction (a 5 MB `encodeStateAsUpdate` plus the covered `seq` X) is one transaction: `BEGIN, UPSERT snapshots, DELETE updates WHERE doc_id = ? AND seq <= X, COMMIT`.
  - Reloading the snapshot plus the rows with `seq > X` gives a Y.Doc equal to the reference.
- [ ] **Crash atomicity during append.** *(gate-blocking)*
  - 200 kills per runner. The harness reads the `ACK <seq>` lines printed after each `COMMIT` returns, and kills after a random 50–2000 ms (`proc.kill("SIGKILL")`, which is TerminateProcess on Windows).
  - On every reopen, `quick_check` reports `ok`, every acked `seq` is present, and the rebuilt state equals the harness's seeded reference.
- [ ] **Crash atomicity during compaction.** *(gate-blocking)*
  - At least 100 of the 200 kills land between `COMPACT_BEGIN` and `COMPACT_ACK`: a 0–20 ms delay after `COMPACT_BEGIN`.
  - The check is the same, and the state is either fully before or fully after the compaction.
- [ ] **Control run with `synchronous=OFF`.** The append harness repeated with `--synchronous=OFF`. Expected to pass too, because the page cache survives a process kill. This shows the kill rows prove atomicity, not durability. If the control fails, the harness is suspect; fix it before trusting the rows above.
- [ ] **Durability evidence.** *(gate-blocking)*
  - The pragma read-back above, plus 4 KB commit times (p50, p95, max, set against the "up to 26 ms" an fsync can take) on the owner's Apple-silicon Mac with `fullfsync` on.
  - A p50 under 1 ms means F_FULLFSYNC isn't happening: fail.
  - Hosted-VM commit tables are context only. Record `Get-MpComputerStatus | Select RealTimeProtectionEnabled` on the Windows runners.
- [ ] **Typing during commits.** The `electron-worker-commits` and `electron-main-commits` arms of Task S5, with its pass rule.
- **Not checked (D24):** there is no FTS5 or `Intl.Segmenter` row, because body search is out of v1 (plan S2 row, v7).
- [ ] **Fallback (only if a `node:sqlite` row fails).** Repeat the failing row with `better-sqlite3` in the worker, and record the native rebuild's cost:
  - `@electron/rebuild` and node-gyp call `node`, so they collide with the stub
  - prebuilds are needed per architecture

**Evidence:**
- pragma JSON per runner
- the owner-Mac commit-time table (hosted tables as context)
- the kill-harness summary per target (kills, kills inside compaction, lost rows = 0, `quick_check` failures = 0), the `synchronous=OFF` control summary, and the logs as artifacts
- the latency table from S5

**Write-up:** `docs/research/2026-11-<dd>-spike-s2-storage-worker.md`.

**Feeds:**
- **D-A1:** decided by S5's commit-arm rule.
  - If `electron-main-commits` passes it, drop the worker. That amends arch D-A1 and §5.4: commits run on main's own thread.
  - Otherwise keep the worker.
- D-A6 pragmas.
- P2.6's soak T1–T8 design.
- `better-sqlite3` only if `node:sqlite` fails.
- **If crash atomicity fails with both drivers, or neither driver shows real fullfsync commit times on the owner's Mac: Tauri revisit.** The `synchronous=OFF` control passing is expected and is not a durability result.

### Task S3: Packaging, the update feed, channels and the brand checks

**Time box:** 4 agent-days (3, plus the v8 brand day), plus about 2 owner-hours.

**Where:**
- Branch: `spike/s3-packaging` from `main`.
- Code: `spikes/s3-packaging/`, holding:
  - `electron-builder.yml`
  - `feed.ts`: a Bun static server on `127.0.0.1:8787` that logs every path it serves
  - `update-probe.ts`: main code that runs `checkForUpdates` and `quitAndInstall(true, true)`, then writes `app.getVersion()` to `$TINYDOCY_USER_DATA/version.txt`
  - `signed-provider.ts`: a custom electron-updater Provider (Linux manifest row)
  - `build/`, holding a placeholder `icon.icon`, `icon.icns`, `icon.ico`, the Linux PNGs and the MIME XML
- It starts as a hello-world app, then merges `spike/s1-shell` to package the real export.
- Linux identifiers are used, not locked: `StartupWMClass=TinyDocy`, MIME type `application/x-tinydoc`, the `tinydocy://` scheme. The first signed Gate 3 build locks them (D33).
- Workflow: `.github/workflows/spike-s3.yml`. Linux jobs that run the AppImage add `sudo apt-get install -y libfuse2t64`.

**Setup:**
```bash
git switch -c spike/s3-packaging main
mkdir -p spikes/s3-packaging && sed '/^\[test\]/,$d' bunfig.toml > spikes/s3-packaging/bunfig.toml && cd spikes/s3-packaging
bun init -y && bun add -d electron@45.<x>.<y> electron-builder@26.<x>.<y> && bun add electron-updater && bun pm trust electron   # builder ≥ 26.2.0
# config: appId placeholder, publish: { provider: generic, url: http://127.0.0.1:8787/feed/ },
# generateUpdatesFilesForAllChannels: true, mac.target [dmg, zip], mac.icon build/icon.icon,
# linux.desktop StartupWMClass TinyDocy, fileAssociations .tinydoc
bun electron-builder --mac dmg zip --arm64 --x64 --publish never      # macos-26 (one invocation, one latest-mac.yml)
bun electron-builder --win nsis --x64 --publish never                  # windows-latest (arm64 on windows-11-arm, informational)
bun electron-builder --linux deb AppImage --x64 --publish never        # ubuntu-24.04 (arm64 on ubuntu-24.04-arm, informational)
bun feed.ts --root dist/feed &
```

Versions are built in one job: N-1 `0.0.1`, N `0.0.2`, beta `0.0.3-beta.1`, stable `0.0.4` and a lower `0.0.0`.

**Pass criteria:**

- [ ] **`bun electron-builder` runs with the Node stub on PATH.** *(gate-blocking)*
  - It builds a DMG and zip (`macos-26`), NSIS (`windows-latest`), and a `.deb` and AppImage (`ubuntu-24.04`).
  - The job log has zero `::error::node was called` lines.
  - If a step needs `node`, name the step. The exception is scoped to that one step (test strategy §2.4).
- [ ] **N-1 updates to N from the generic feed.** Before updating, write a marker file into `TINYDOCY_USER_DATA`; afterwards, `version.txt` reads `0.0.2` and the marker is intact.
  - NSIS: `windows-latest`, silent install `/S`. *(gate-blocking)*
  - AppImage: `ubuntu-24.04` under xvfb. *(gate-blocking)*
  - `.deb`: on a real Ubuntu 24.04 desktop, because of the polkit prompt. CI records the download, the sha512 check and the install command electron-updater runs.
  - macOS: only with a Developer ID signature, because Squirrel.Mac checks the new bundle against the installed one. Without enrolment it is "checked at Gate 3 instead" (plan S3).
- [ ] **The generic feed "ignores this repo's web releases".** The net-log and the feed log show requests to `127.0.0.1:8787/feed/` only, and none to `api.github.com` or `github.com`.
- [ ] **Linux manifests are signed and checked, or the gap is written down.**
  - Try a detached Ed25519 signature on `latest-linux.yml` and `beta-linux.yml`, checked by `signed-provider.ts`: a custom Provider that verifies the exact bytes it parses (`crypto.verify`), so nothing is fetched between the check and the parse.
  - Pass: a tampered manifest is refused.
  - Otherwise record "Linux shows **Download update**" (plan §7).
- [ ] **Channels.**
  - A `-beta.N` build requests `beta.yml` (`beta-mac.yml` on macOS, `beta-linux.yml` on Linux).
  - "Stable builds also write `beta.yml`": a stable build with `generateUpdatesFilesForAllChannels` writes all three beta files, and a beta-channel `0.0.3-beta.1` install is offered stable `0.0.4` once that is published.
  - Record the mapping table from `prefs.updates.channel` (Stable/Beta) to electron-updater's `channel` and `allowPrerelease`. The default channel is computed, never stored.
- [ ] **`allowDowngrade` stays off.** Both the `channel` setter and `generateUpdatesFilesForAllChannels` turn it on, so it "must be set to `false` explicitly". *(S3 correction: in electron-updater 6.8.11 only the `channel` setter turns it on; the flag is build-time only.)*
  - Log `allowDowngrade` after construction, after the channel setter and before each `checkForUpdates`.
  - `allowDowngrade = false` is the last assignment before every check.
  - A feed offering `0.0.0` installs nothing (`version.txt` unchanged) on the default path (no channel set) and on the Beta→Stable path (a `0.0.3-beta.1` install switched to Stable).
- [ ] **Two Mac DMGs ("two DMGs, not a universal build").** One invocation writes the arm64 and x64 DMGs and zips, and one `latest-mac.yml` lists both zips. An x64 install on `macos-26-intel` requests the x64 zip (feed log).
- [ ] **Icons.**
  - On `macos-26`, `mac.icon: build/icon.icon` produces `Contents/Resources/Assets.car` with `CFBundleIconName`, and `icon.icns` is shipped alongside (`CFBundleIconFile` via `extendInfo`).
  - Record the exact electron-builder version that does this.
  - Evidence: an icon export on `macos-26` (`NSWorkspace.iconForFile`, written to PNG through `osascript -l JavaScript`) and the owner's Tahoe Dock screenshot.
  - Record whether the ICNS/ICO packers are scripts or `iconutil` (brand §3).
- [ ] **WM class.** `xprop WM_CLASS` under X11 (xvfb) shows `TinyDocy`, matching `StartupWMClass`. On real GNOME Wayland the dock shows the app icon, not a generic one (screenshot).
- [ ] **The `.deb` MIME entry.**
  - `dpkg -c` lists the shared-mime-info XML.
  - After install, `xdg-mime query filetype sample.tinydoc` gives `application/x-tinydoc`, and `xdg-mime query default application/x-tinydoc` gives `tinydocy.desktop`.
- [ ] **AppImage sandbox on current Ubuntu.** "Never tell users to pass `--no-sandbox`".
  - On a real Ubuntu 24.04 desktop (no CI sysctl), record whether `libfuse2t64` is present and the `kernel.apparmor_restrict_unprivileged_userns` value.
  - Record whether the AppImage starts without `--no-sandbox`, with the renderer's `/proc/<pid>/status` showing `Seccomp: 2`.
  - Pre-registered expected outcome: it can't, and `/download` says "`.deb` recommended on Ubuntu 24.04+" (brand §4.3).
- [ ] **Signing, only if enrolment is done.** The owner signs and notarizes the DMG locally, then checks `spctl -a -vv` and `stapler validate`. The Azure `azureSignOptions` key is confirmed. Otherwise: "checked at Gate 3".

**Evidence:**
- the job logs (stub grep)
- feed logs per update test
- the channel table and the `allowDowngrade` log
- `latest-mac.yml`, `beta.yml`, `beta-mac.yml` and `beta-linux.yml` contents
- `Info.plist` excerpts, icon PNGs, `xprop` and `xdg-mime` output, the AppImage sandbox result
- installer sizes per OS
- workflow run URLs

**Write-up:** `docs/research/2026-11-<dd>-spike-s3-packaging-updates.md`.

**Feeds:**
- arch §3.1 step 3 (`bun electron-builder`)
- P3.1–P3.3: the feed, the channel mapping, `allowDowngrade`
- plan §7 (Linux download fallback)
- K8
- B2 config
- the `/download` copy
- whether the Forge fallback is needed

### Task S4: Playwright `_electron` drives the packaged app across a relaunch

**Time box:** 1 agent-day.

**Where:**
- Branch: `spike/s4-electron-e2e` from `spike/s1-shell`, packaged with S3's config. It tests the offline device copy that P1.1 changes, so merge `main` into it after P1.1 lands and rerun.
- Code: `spikes/s4-electron-e2e/persist.spec.ts` and `playwright.config.ts`.
- Workflow: `.github/workflows/spike-s4.yml`.

**Setup:**
```bash
git switch -c spike/s4-electron-e2e spike/s1-shell && git merge spike/s3-packaging
cd spikes/s3-packaging && bun electron-builder --dir --publish never   # unpacked app per OS
DB_PATH=$(mktemp -d)/s4.sqlite HOCUS_THROTTLE=0 HOCUS_ALLOWED_ORIGINS=app://tinydocy bun run hocus &   # D-A11, decided by S1
CI= bun playwright test -c spikes/s4-electron-e2e/playwright.config.ts
```

**Pass criteria:**

- [ ] **The relaunch keeps the text.**
  - `_electron.launch({ executablePath: <packaged binary>, env: { TINYDOCY_USER_DATA } })` opens the first window.
  - The test creates a document (new tab), types `S4 persists 日本語`, quits through `app.close()`, stops Hocus, and relaunches with the same user data.
  - The text is still there, from the origin's device copy (`lib/offline/`).
  - After Hocus restarts, `data-server-synced` is set.
  - Runners: `macos-26`, `windows-latest`, `ubuntu-24.04` (xvfb).
  - `useSyncedTabs` renders the tab list from the `global-tabs` device copy before a server sync, so the new tab should come back offline. If it doesn't, open the document by id (`activeTabId` from storage) and record an app finding, not a harness failure.
- [ ] **The spec is stable.** It passes `--repeat-each=10` on each of the three runners, before and after the `main` merge. Record the wall time per run.

**Evidence:** the Playwright HTML reports and traces as artifacts, plus workflow run URLs.

**Write-up:** `docs/research/2026-11-<dd>-spike-s4-electron-e2e.md`. The spec goes in an appendix for P2.5.

**Feeds:**
- the `electron` Playwright project (arch §11)
- P2.5's persistence spec, which swaps the device copy for the P2.6 store

### Task S5: Typing latency against Chrome, commit arms, and IME

**Time box:** 2 agent-days, plus about 3 owner-hours: an IME session on each OS and the real-machine latency runs.

**Where:**
- Branch: `spike/s5-latency-ime` from `spike/s1-shell`, merged with `spike/s2-storage` for the commit-loop modes.
- Code:
  - `spikes/s5-latency-ime/latency.spec.ts`, which imports `tests/e2e/helpers/perf-observer.ts` (`injectKeystrokeTimer`, `collectKeystrokeLatencies`, `percentile`, `median`) and `generateLargeDocument`
  - `serve-out.ts`, which serves `out/` on 127.0.0.1 for the Chrome arms
  - `ime-checklist.md`
- Workflow: `.github/workflows/spike-s5.yml`.

**Budget and harness:** "Typing latency is within 10% of Chrome on the `perf` spec". `PERF_CPU_THROTTLE` 4, `PERF_ROUNDS` 7, `KEYSTROKES` 220, `WARMUP_KEYSTROKES` 20, p95 per round, then the median of the rounds. The verdict comes from the owner's M1 and a Windows laptop with Defender on (test strategy §1.4, `Get-MpComputerStatus` recorded). Hosted runners are context only: `windows-latest` is Windows Server with an unknown Defender state.

**Setup:**
```bash
git switch -c spike/s5-latency-ime spike/s1-shell && git merge spike/s2-storage
bunx --bun @puppeteer/browsers install chrome@156   # Chrome for Testing, same major as Electron 45
bun spikes/s5-latency-ime/serve-out.ts &
PERF_HEADINGS=50,500 PERF_ROUNDS=7 PERF_CPU_THROTTLE=4 CHROME_PATH=<cft binary> CI= bun playwright test -c spikes/s5-latency-ime/playwright.config.ts
```

Five arms run on the same document with the same CDP throttle, interleaved: each round runs every arm once, in a rotated order.
- `chrome` and `chrome-control`: two separate launches of Chrome for Testing 156 (`chromium.launch({ executablePath })`); their ratio is the noise floor
- `electron-idle`
- `electron-worker-commits`
- `electron-main-commits`: S2's `commit-loop` back-to-back with `fullfsync`

**Pass criteria:**

- [ ] **Electron is within 10% of Chrome.**
  - `electron-idle` p95 ≤ 1.10 × the `chrome` p95 at 50 and 500 headings, measured with `perf-observer.ts`, on the two verdict machines.
  - The `chrome-control` / `chrome` ratio is reported next to each verdict as the noise floor.
  - Record the Electron and Chrome for Testing versions.
- [ ] **The commit arms (D-A1).** CDP-dispatched keys are stamped when main handles them, so `perf-observer.ts` alone can't see main-thread stalls.
  - For the commit arms, latency runs from the runner's `Date.now()` immediately before each key to the renderer's `Date.now()` in the input-event microtask (same machine clock), compared with the `electron-idle` arm. `electron-idle` records this measure too.
  - Main records `perf_hooks.monitorEventLoopDelay` p99 and max per arm.
  - `electron-worker-commits` passes at a ratio vs idle ≤ 1.10.
  - Commits on main's own thread pass only if:
    - the p95 latency ratio against `electron-idle` is ≤ 1.10 at **both** 50 and 500 headings, on **both** verdict machines (four ratios, all ≤ 1.10);
    - main's event-loop-delay p99 is ≤ 8 ms in every one of those runs.
  - Otherwise D-A1 keeps the worker.
  - Record the commits per second achieved.
- [ ] **Japanese IME on macOS and Windows.**
  - Engines: Japanese Romaji input on macOS, and Microsoft IME Japanese on Windows 11.
  - Compose `nihongo`, convert and commit 日本語 in each of these: the title, a paragraph, a heading, a list item, a table cell, a code block.
  - Pass in each:
    - no duplicated or lost characters
    - the candidate window sits at the caret
    - Enter during composition commits and doesn't split the block
    - one undo removes the committed word
    - "/" typed inside a composition doesn't open the slash menu
  - A collaborator's edit arriving during a composition doesn't break it.
- [ ] **CJK IME on GNOME Wayland.**
  - The same list on Ubuntu 24.04 GNOME Wayland with IBus and Mozc, on native Wayland (Electron's default `--ozone-platform=auto`).
  - If it fails, repeat with `--ozone-platform=x11`. If that passes, the result is "falls back to XWayland".
  - Record the XWayland effect on scaling: a fractional-scaling screenshot.

**Evidence:**
- a latency table: arm × headings × machine, with p95 rounds, medians, the noise floor and event-loop delay
- the IME checklist, ticked per OS, with short screen recordings (under 10 s) or screenshots of the candidate window
- workflow run URLs

**Write-up:** `docs/research/2026-11-<dd>-spike-s5-latency-ime.md`.

**Feeds:**
- D-A1, together with S2
- K11
- the nightly "Typing in Electron vs Chrome" budget (test strategy §1.4)
- the Linux Wayland/XWayland default in P2.5
- **Tauri is not reopened by S5 alone.** A Linux IME failure with no XWayland fallback goes to the owner as a Linux-scope decision.

### Task S6: Carry the D-A12 smoke into `main` (the one mergeable PR)

**Time box:** 1 agent-day, after S2's pragma row passes. This is production code, not a spike, so it follows the normal PR rules. D-A12 exists because Electron 37.2.0 shipped without `node:sqlite` (electron/electron#47671).

**Branch:** `ci/desktop-smoke`. **PR title:** `ci(desktop): add the D-A12 Electron smoke test`.

**Files:**
- Create `desktop/smoke/package.json`: Electron pinned exactly, with its own `bun.lock` and a `bunfig.toml` holding the root's `[install]` and `[run]`.
- Create `desktop/smoke/main.ts`, `desktop/smoke/worker.ts` and `desktop/smoke/fixture/index.html`.
- Modify `tsconfig.json` to add `desktop/smoke` to `exclude`. The root `include` is `**/*.ts`, and the root `bun install` doesn't install `electron`. Type the smoke with `desktop/smoke/tsconfig.json` (`node` plus Electron types).
- Create `.github/workflows/desktop-smoke.yml`, triggered by `workflow_dispatch`, `workflow_call`, and `pull_request` with `paths: [desktop/smoke/**, .github/workflows/desktop-smoke.yml]` (not a required check). Matrix: `macos-26`, `windows-latest`, `ubuntu-24.04` (`xvfb-run -a`, plus the sandbox sysctl step). Steps: install in `desktop/smoke`, `bun audit --audit-level=high` there (its own lockfile), the Node stub, build, run.
- Modify `.github/workflows/nightly.yml`: add a job `desktop-smoke: { permissions: { contents: read }, uses: ./.github/workflows/desktop-smoke.yml }`, so the smoke runs on the existing nightly schedule with no cron of its own.
- Modify `tests/unit/ci/workflow-permissions.test.ts`: accept local `./.github/workflows/…` refs in the SHA-pin check (they resolve at the same commit) and add a case for that.
- Modify `CHANGELOG.md` under Unreleased.

**Interfaces:**
- **Consumes:** none.
- **Produces:** an exit code. `0` means all four checks passed. `1` comes with a `SMOKE_FAIL <check>` line on stderr.

**Steps:**
- [ ] **Step 1: Write the smoke.**
  - `main.ts` checks four things, in order:
    - `require("node:sqlite")` succeeds
    - `PRAGMA journal_mode=WAL` returns `wal`
    - a worker opens the same database and round-trips one row
    - a custom `app://smoke` scheme, registered standard and secure, serves `fixture/index.html`, and the window reports `document.title === "smoke"`. P2.5 retargets this check to the D-A11 origin (`app://tinydocy`) and the real export, and moves the smoke under the `electron` project.
  - It then exits with `0`.
- [ ] **Step 2: See it fail.** Run `bun electron desktop/smoke/dist/main.cjs` with `SMOKE_BREAK=wal`. Expect exit code `1` and `SMOKE_FAIL wal`.
- [ ] **Step 3: See it pass.**
  - Run `bun electron desktop/smoke/dist/main.cjs`. Expect exit code `0`.
  - Run `desktop-smoke.yml` on all three runners, and dispatch `nightly.yml` on the branch to see the called job pass.
  - At the root, `bun run typecheck && bun run check && bun run lint` pass with no `electron` installed there.
  - Run `bun test tests/unit/ci/workflow-permissions.test.ts` and expect a pass, including the new local-ref case.
- [ ] **Step 4: Changelog and review report.**
  - CHANGELOG line: "**CI:** a desktop smoke test checks, on every Electron bump and nightly, that `node:sqlite` loads, WAL works, SQLite runs in a worker thread and a custom app protocol serves pages (D-A12)."
  - No Deploy note.
  - Show the commit review report, wait for owner approval, then commit with no trailers.

---

### Write-ups and decisions (one docs PR)

**Branch:** `docs/phase-1-spike-results`. **PR title:** `docs(research): record the Phase 1 spike results`.

**Contents:**
- the five write-ups
- `docs/research/spike-evidence/`
- the amendments:
  - arch §1: D-A1 and D-A11, the "decided by S1/S2/S3/S5" rows, §3.1
  - plan §4, §7, §8.4 and §11 (K8, K11)
  - test strategy §4.1 (channel mapping) and §6.1 (the Gate 1 staging substitute checks)
  - brand §3 and §4.3 (`.icon` version, DMGs, AppImage copy)
  - the CSP amendment, if S1's pre-registered one was needed

**Each write-up uses one template:**
- the question
- versions: Electron, Chromium, Node, electron-builder, runner images, OS builds
- a results table: each checkbox, with pass, fail or value, gate-blocking or not, and the OS and workflow run URL
- the evidence
- the decision, and the spec lines it changes
- issues filed

**Merge rules:** add the CHANGELOG line ("**Docs:** Phase 1 spike results and the decisions they settle (D-A1, D-A11)"). Show the commit review report and get approval, with no trailers. Spike branches stay unmerged.

### Owner prerequisites

Day 1 is the day S1–S3 start.

| Need | For | Needed by | Fallback if missing |
|---|---|---|---|
| Confirm the current secret scopes: signing and deploy secrets are environment secrets with a `main`/`v*`-tag branch policy and a required reviewer, none at repo level | every spike workflow (branch pushes can read repo-level secrets) | day 1, before the first spike push | Move any repo-level secret into an environment first; no spike pushes until then. |
| The owner's Apple-silicon Mac (M1) | S2 durability evidence, S1 double-click, S5 latency verdict | day 3 | None: durability is gate-blocking, so Gate 1 waits. |
| A Tahoe 26.4+ Mac with Icon Composer (placeholder `.icon`, Dock screenshot) | S3 icons | day 2 | Ship `icon.icns` only and carry the `.icon` row to P2.5. |
| A real Windows 11 24H2+ machine | S1 snap layouts | day 3 | Native frame on Windows (the UX fallback). |
| A Windows laptop with Defender on | S5 latency verdict and commit arms | day 5 | The Windows typing verdict opens a P2.5 issue; D-A1 is decided on the Mac alone, keeping the worker. |
| A real Ubuntu 24.04 desktop | S3 `.deb` polkit prompt, AppImage sandbox, Wayland dock | day 4 | A GNOME VM; the AppImage row records the pre-registered outcome. |
| GNOME Wayland and KDE (a Linux tester or a VM) | S1 GTK frame, S5 Linux IME | day 5 | Rows carried to P2.5; a GNOME-only result is recorded as such. |
| Japanese IME on macOS and Windows, IBus with Mozc on GNOME Wayland (about 2 h) | S5 IME | day 6 | Rows carried to P2.5. |
| Signing enrolment (D35, organisation; Apple Developer ID and Azure Artifact Signing) | S3 macOS update and signing; Gate 1 | applications filed before Gate 1 | macOS update and signing checked at Gate 3. |
| Staging provisioned (plan §8.3) | Gate 1 | Gate 1 sign-off | None: Gate 1 waits. |

**Order and parallel tracks:**
- **Day 1, in parallel:** S1, S2 and S3 (hello-world first), each in its own worktree with disjoint `spikes/<name>/` ownership.
- **After S1's export runs:** S4 and S5 start, and S3 merges `spike/s1-shell`.
- **After S2's pragma row:** S6.
- **After P1.1 lands:** S4 merges `main` and reruns.
- **Total:** about 14 agent-days, inside Gate 1's 2–3 weeks.

### Gate 1 checklist

- [ ] S1–S5 write-ups merged, each results table complete with workflow run URLs and evidence on 3 OSes (test strategy §6.1).
- [ ] Every gate-blocking row passes: S1 export, CSP and embeds; S2 crash atomicity (append, compaction) and durability evidence; S3 `bun electron-builder` and N-1→N on NSIS and AppImage.
- [ ] Decisions recorded and amended in the docs PR: D-A1 (S5 commit-arm row), D-A11 (S1 rows on both origins), `pageExtensions` or the overlay and CJS bundles (S1 export row), `bun electron-builder` (S3 first row), the channel mapping (S3 channels row), the preload boot path (S1 preload row).
- [ ] The D-A12 smoke (S6) is green on `main` on `macos-26`, `windows-latest` and `ubuntu-24.04`, and in the nightly run.
- [ ] **Staging is reachable** (owner prerequisite). `/api/info` doesn't exist until P4.2d, so Gate 1 uses two substitute checks:
  - `curl -sfI https://<staging host>/` returns 200
  - a Bun WebSocket script syncs one document with the staging Hocus
- [ ] Signing enrolment is under way (owner prerequisite, D35): the Apple and Azure application dates are recorded in the Gate 1 issue.
- [ ] If an S1 or S2 Tauri-revisit branch fired, the owner's decision is recorded in plan §13.
- [ ] Spike branches are left unmerged.
