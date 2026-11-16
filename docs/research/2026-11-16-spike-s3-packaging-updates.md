# Spike S3: packaging, the update feed, channels and the brand checks

- **Date:** 2026-11-16
- **Plan:** [Phase 1 spikes](../superpowers/plans/2026-11-16-phase-1-spikes.md), Task S3
- **Branch:** `spike/s3-packaging` (from `main` at e93169d; never merged, no PR). Code in `spikes/s3-packaging/`, workflow `.github/workflows/spike-s3.yml` (push to the branch and `workflow_dispatch`; no `secrets.` or `environment:`; passes `tests/unit/ci/workflow-permissions.test.ts`).
- **Final run:** [43915218016](https://github.com/docs-plus/editor/actions/runs/43915218016) (commit e834984), every job green. The icon-export step on `macos-26-intel` timed out (`continue-on-error`; see row 8b). Earlier run: [43911539534](https://github.com/docs-plus/editor/actions/runs/43911539534) (commit 71a2a67). Its gate rows passed too, and its WM_CLASS mismatch led to the `desktopName` fix.
- **Scope:** a hello-world app. `spike/s1-shell` wasn't on origin when S3 ran, so packaging the real static export moves to S4 and P2.5. Every build is unsigned: signing enrolment (D35) is pending.
- **Evidence:** [`spike-evidence/s3/`](spike-evidence/s3/) holds the update reports (feed and probe logs), sandbox probes, log excerpts, the feed `.yml` files and the icon export.
- **Result:** every gate-blocking row passes: `bun electron-builder` with the Node stub, and N-1 → N on NSIS and on AppImage. The rows for macOS updates and signing are pending owner signing enrolment (D35). The rows that need a real desktop are pending owner hardware.

## The question

Can `bun electron-builder` package the app for macOS, Windows and Linux with nothing calling `node`? Does electron-updater move an install from N-1 to N from a generic feed that never touches GitHub? Do the Stable/Beta channels, `allowDowngrade` and signed Linux manifests behave the way the plan relies on? And do the icon, WM class, MIME and sandbox details hold on current macOS and Ubuntu?

## Versions

| Item | Value |
|---|---|
| Electron | 45.3.1 (exact pin; published 2026-11-12, passes `minimumReleaseAge` 3 d) |
| Chromium (bundled) | 156.0.8078.96 (`process.versions.chrome` in the packaged app) |
| Node (bundled) | 24.22.2 (`process.versions.node`) |
| electron-builder | 26.18.0 (exact pin) |
| electron-updater | 6.8.11 (exact pin) |
| Bun | 1.4.4 (`.tool-versions`) |
| macos-26 | image macos26 20261102.0473.1, macOS 26.7.2 (25G332), arm64, Xcode 26.6 (17F113) |
| macos-26-intel | image macos26 20260824.0517.1, macOS 26.6.1 (25G76), x86_64, Xcode 26.6 (17F113) |
| windows-latest | image win25-vs2026 20261103.298.1, Windows Server 2025, `ver` 10.0.26100.33674 |
| ubuntu-24.04 | image ubuntu24 20261111.370.1, Ubuntu 24.04.5 LTS, kernel 7.0.0-1017-azure |
| ubuntu-24.04-arm (informational) | image ubuntu24-arm64 20261111.182.1, aarch64 |
| windows-11-arm (informational) | image win11-vs2026-arm64 20261112.217.1 (NT 10.0-26200 ARM64) |

**Electron 45 has no install script.** The 45.3.1 npm package has no install script: `index.js` / the `install-electron` bin fetch the binary lazily. So `bun pm trust electron` reports "0 scripts ran … don't have scripts to run". `trustedDependencies: ["electron"]` was added by hand for parity. electron-builder downloads its own Electron zip, so packaging never needs the npm binary. The plan's note "Its postinstall downloads the binary" no longer holds for 45.x.

## Results table

Run URL for every row: [43915218016](https://github.com/docs-plus/editor/actions/runs/43915218016), unless a row says otherwise.

| # | S3 checkbox / row | Gate | OS / runner | Result | Value / evidence |
|---|---|---|---|---|---|
| 1a | `bun electron-builder` with the Node stub: DMG + zip | **yes** | macos-26 | **PASS** | `--mac dmg zip --arm64 --x64` in one invocation (0.0.1, 0.0.2), plus zip arm64 for 0.0.3-beta.1 and 0.0.4. Builder logs: 0 `node was called`. Job log: 0 `##[error]` annotations. |
| 1a′ | same | info | macos-26-intel | PASS | Both arches in one invocation. 0 stub hits. |
| 1b | `bun electron-builder` with the Node stub: NSIS | **yes** | windows-latest | **PASS** | 5 versions. 0 stub hits in builder logs and in the whole job log (0 annotations). Windows stub = the verbatim sh stub plus a `bun build --compile` `node.exe` in the same dir. `where.exe node` lists `D:\a\_temp\no-node\node` and `…\node.exe` first, and `node --version` → "(stub) node was called: --version (exit code 1)". |
| 1c | `bun electron-builder` with the Node stub: deb + AppImage | **yes** | ubuntu-24.04 | **PASS** | 5 versions, deb + AppImage x64. 0 stub hits, 0 annotations. |
| 1d | same, arm64 | info | ubuntu-24.04-arm, windows-11-arm | PASS | deb + AppImage arm64, NSIS arm64. 0 stub hits. |
| 1e | Step that needs `node` | — | all | **none** | No exception is needed. The builder logs "bun does not support any CLI for dependency tree extraction, utilizing file traversal collector instead" (no `npm list`). `@electron/rebuild` runs in-process with no native deps. |
| 2a | N-1 0.0.1 → N 0.0.2: NSIS, silent `/S` | **yes** | windows-latest | **PASS** | `version.txt` = 0.0.2, marker intact. The relaunched app got `argv=["--updated"]`. Feed: `latest.yml` → `tinydocy-0.0.2-setup.exe 200` → `latest.yml` (from 0.0.2). |
| 2b | N-1 0.0.1 → N 0.0.2: AppImage under xvfb | **yes** | ubuntu-24.04 | **PASS** | `version.txt` = 0.0.2, marker intact. Feed: `latest-linux.yml` → `tinydocy-0.0.2-x86_64.AppImage 200` → `latest-linux.yml`. Runs after the plan's sysctl step (restrict=0). |
| 2c | `.deb` update | owner | ubuntu-24.04 (CI record) | recorded; real desktop **pending owner hardware** | Download `tinydocy_0.0.2_amd64.deb 200`, checked against the sha512 in `latest-linux.yml` (no mismatch error). Install command: the runner has no `pkexec`/`gksudo`/`kdesudo`/`beesu`, so electron-updater logged "Running as non-root user, using sudo to install" and ran `sudo /bin/bash -c 'dpkg -i ~/.cache/tinydocy-updater/pending/tinydocy_0.0.2_amd64.deb'`. Passwordless sudo then installed 0.0.2. On a desktop it would use `pkexec`, so the polkit prompt row stays with the owner. |
| 2d | macOS update | — | macos-26, macos-26-intel | **pending owner signing enrolment (D35); checked at Gate 3** | Unsigned outcome as expected: electron-updater downloaded the zip, and then Squirrel.Mac refused it with "Code signature at URL file:///…ShipIt/update.…/TinyDocy.app/ did not pass validation: code has no resources but signature indicates they must be present". `version.txt` stays 0.0.1. |
| 3 | Generic feed only (no api.github.com / github.com) | no | all OSes | **PASS** | Every update scenario greps the Chromium net-log (`--log-net-log`) of every app run: `github.com` hits = 0, `127.0.0.1:8787` hits 16–59. Feed logs show only `/feed/…` paths. |
| 4 | Linux manifests signed and checked | no | ubuntu-24.04 | **PASS** | Detached Ed25519 (throwaway key generated in the job; public key built in via `--define`; private key only in `$RUNNER_TEMP`). Valid: `latest-linux.yml.sig` fetched, "signature valid=true", installs 0.0.2. Tampered (version → 9.9.9, same .sig): "signature valid=false" and "event error manifest-signature: latest-linux.yml failed Ed25519 verification, refusing it". No AppImage was requested and `version.txt` stays 0.0.1. Also checked locally on macOS with `latest-mac.yml`. |
| 5a | `-beta.N` requests `beta*.yml` | no | win / linux / mac | **PASS** | 0.0.3-beta.1 has `channel: beta` in its `app-update.yml` (builder `detectUpdateChannel`). Its first request is `beta.yml` (Windows), `beta-linux.yml` (Linux) or `beta-mac.yml` (macOS). |
| 5b | Stable with `generateUpdatesFilesForAllChannels` writes the beta files | no | all | **PASS** | Stable 0.0.4 writes `latest*.yml` + `beta*.yml` + `alpha*.yml`. Beta 0.0.3-beta.1 writes `beta*.yml` + `alpha*.yml` and no `latest*.yml`. |
| 5c | 0.0.3-beta.1 install is offered stable 0.0.4 | no | win, linux (install); mac (offer) | **PASS** | Windows and Linux: `beta(-linux).yml` → 0.0.4 installer → `version.txt` 0.0.4; the relaunched stable 0.0.4 then asks for `latest*.yml`. macOS (check-only): `beta-mac.yml`, `isUpdateAvailable=true`. |
| 5d | Channel mapping table | no | — | recorded | See "Channel mapping" below. |
| 6a | `allowDowngrade` logged and `false` set last | no | win, linux, mac | **PASS** | Logged after construction, after the channel setter and right before `checkForUpdates`. `allowDowngrade = false` is the last assignment before every check (excerpt below). |
| 6b | 0.0.0 feed, default path | no | win, linux | **PASS** | 0.0.1 vs 0.0.0: "Update for version 0.0.1 is not available (latest version: 0.0.0, downgrade is disallowed)". No installer was requested and `version.txt` stays 0.0.1. |
| 6c | 0.0.0 feed, Beta→Stable | no | win, linux | **PASS** | 0.0.3-beta.1 with pref Stable: the setter flips `allowDowngrade=true`, and the reset puts it back to `false`. Requests `latest(-linux).yml`; nothing installed, and `version.txt` stays 0.0.3-beta.1. |
| 6d | Negative control | info | linux | as predicted | Same path with the reset skipped: `allowDowngrade=true`, and **0.0.0 was installed** (`version.txt` 0.0.0). This proves the 6c test can fail. |
| 6e | "`generateUpdatesFilesForAllChannels` turns allowDowngrade on" | — | — | **not true at runtime** | In electron-updater 6.8.11 only the `channel` setter sets `allowDowngrade = true` (AppUpdater.js `set channel`). `generateUpdatesFilesForAllChannels` is build-time only and writes the extra yml files. A build with it on logs `after construction allowDowngrade=false`. |
| 7a | Two Mac DMGs, one `latest-mac.yml` | no | macos-26, macos-26-intel | **PASS** (with a quirk) | One invocation writes `-arm64.dmg`, `-x64.dmg`, `-mac-arm64.zip` and `-mac-x64.zip`, and one `latest-mac.yml` lists both zips. Quirk: with `generateUpdatesFilesForAllChannels` the files list repeats each arm64 zip, x64 dmg and arm64 dmg 3× (once per channel). The legacy `path:` points at the x64 zip. electron-updater still picks by arch. |
| 7b | x64 install requests the x64 zip | no | macos-26-intel | **PASS** (feed side) | Feed: `latest-mac.yml` → `tinydocy-0.0.2-mac-x64.zip 200`, no `mac-arm64`. On macos-26 the arm64 install fetched `-mac-arm64.zip`. Squirrel then refuses the unsigned bundle (row 2d). |
| 8a | `mac.icon: build/icon.icon` → `Assets.car` + `CFBundleIconName` | no | macos-26 (+ intel) | **PASS** | electron-builder **26.18.0** with Xcode 26.6 `actool`. `Contents/Resources/Assets.car` (1,752,888 B), `CFBundleIconName = "Icon"`, `CFBundleIconFile = "icon.icns"` (extendInfo), and `icon.icns` (33,773 B, via `extraResources`) alongside. `assetutil --info` lists IconGroup/IconImageStack renditions of `Icon` with `Icon_Assets/glyph` and `Gradient-1/2`. |
| 8b | Icon export PNG | no | macos-26 | **PASS** | `osascript -l JavaScript export-icon.js` (NSWorkspace `iconForFile`) → [`spike-evidence/s3/icon-macos-26-arm64.png`](spike-evidence/s3/icon-macos-26-arm64.png) (256², 34.8 KB): the Liquid-Glass rendering from Assets.car. On **macos-26-intel the same osascript hung** (>15 min in run 1, hit the 4-min step timeout in run 2, `continue-on-error`). That runner is informational for icons. |
| 8c | Tahoe Dock screenshot | no | owner Mac | **pending owner hardware** | — |
| 8d | ICNS/ICO packers: scripts or `iconutil` | no | — | **scripts** | `make-icons.ts` (pure TS: PNG encoder, ICO with BMP entries 16–128 + PNG 256, ICNS with PNG `icp4…ic14` entries) runs on any OS. `iconutil -c iconset` on macos-26 only verifies the ICNS (11 PNGs round-trip). NSIS accepted the ICO. |
| 9a | `xprop WM_CLASS` under xvfb = `TinyDocy` | no | ubuntu-24.04 | **PASS (after a config fix)** | Run 1 with `desktopName: tinydocy.desktop` gave `WM_CLASS = "tinydocy", "tinydocy"`: **mismatch**. Electron 45 takes the X11 class (and the Wayland app_id) from desktopName minus `.desktop`. Run 2 with `desktopName: TinyDocy.desktop` gave `"tinydocy", "TinyDocy"`; the class matches `StartupWMClass=TinyDocy`. The installed file stays `tinydocy.desktop` (executableName; `syncDesktopName` off). |
| 9b | GNOME Wayland dock icon | no | owner | **pending owner hardware** | With app_id now `TinyDocy` and the file `tinydocy.desktop`, the dock association relies on `StartupWMClass=TinyDocy`. The owner should check this exact case. |
| 10 | `.deb` MIME entry | no | ubuntu-24.04 | **PASS** | `dpkg -c` lists `./usr/share/mime/packages/tinydocy.xml` (286 B) and `./usr/share/applications/tinydocy.desktop` (`MimeType=application/x-tinydoc;x-scheme-handler/tinydocy;`). After `sudo apt-get install ./tinydocy_0.0.1_amd64.deb` with `XDG_CURRENT_DESKTOP=GNOME`: `xdg-mime query filetype sample.tinydoc` → `application/x-tinydoc`, and `xdg-mime query default application/x-tinydoc` → `tinydocy.desktop`. Without a desktop set, filetype falls back to `file` → `text/plain`. |
| 11a | AppImage sandbox, runner values | no | ubuntu-24.04 | measured | Before any change: `kernel.apparmor_restrict_unprivileged_userns=1` (same as the Ubuntu desktop default), `libfuse2t64` **not installed**, no `libfuse.so.2`. |
| 11b | AppImage starts without `--no-sandbox`? | no | ubuntu-24.04 | **No (pre-registered outcome holds)** | At restrict=1 the AppImage *launches*, but only because electron-builder's `AppRun` probes `unshare -Ur true` and **injects `--no-sandbox`** when it fails. The main process gets `argv=["--no-sandbox"]` and the renderer shows `Seccomp: 0`. At restrict=0 (the CI sysctl): `argv=[]`, renderer `Seccomp: 2`. |
| 11c | `.deb` sandbox at restrict=1 | info | ubuntu-24.04 | sandboxed | The deb postinst installs `/etc/apparmor.d/tinydocy` (userns profile) → renderer `Seccomp: 2` at restrict=1, `argv=[]`, `chrome-sandbox` mode 0755. So `/download` should say ".deb recommended on Ubuntu 24.04+". |
| 11d | Real Ubuntu desktop, no CI sysctl | no | owner | **pending owner hardware** | The runner default equals the desktop default (1). The runner result above is the expected desktop behaviour. |
| 12 | Signing, notarization, `spctl`/`stapler`, Azure `azureSignOptions` | no | — | **pending owner signing enrolment (D35); checked at Gate 3** | `mac.identity: null`; NSIS reports "no code signing certificate configured, signing is skipped". |

## Installer sizes (run 43915218016, bytes)

| OS | Artifact | Size |
|---|---|---|
| macOS arm64 | `tinydocy-0.0.2-arm64.dmg` | 122,814,343 (117.1 MiB) |
| macOS x64 | `tinydocy-0.0.2-x64.dmg` | 126,809,225 (120.9 MiB) |
| macOS arm64 | `tinydocy-0.0.2-mac-arm64.zip` (update payload) | 119,316,779 (113.8 MiB) |
| macOS x64 | `tinydocy-0.0.2-mac-x64.zip` (update payload) | 123,312,553 (117.6 MiB) |
| Windows x64 | `tinydocy-0.0.2-setup.exe` (NSIS) | 121,664,011 (116.0 MiB) |
| Windows arm64 | `tinydocy-0.0.1-setup.exe` | 115,770,021 (110.4 MiB) |
| Linux x64 | `tinydocy-0.0.2-x86_64.AppImage` | 126,111,946 (120.3 MiB) |
| Linux x64 | `tinydocy_0.0.2_amd64.deb` | 101,348,416 (96.7 MiB) |
| Linux arm64 | `tinydocy-0.0.1-arm64.AppImage` / `tinydocy_0.0.1_arm64.deb` | 127,330,818 / 96,192,892 |

Build time per version: Windows NSIS 54–58 s. Linux deb+AppImage 61–67 s. macos-26 two-arch DMG+zip 109–120 s (zip-only arm64 69–75 s). macos-26-intel two-arch 260–280 s.

## Channel mapping (`prefs.updates.channel` → electron-updater)

| Pref | Stored? | `autoUpdater.channel` | `allowPrerelease` | Feed file requested | Then |
|---|---|---|---|---|---|
| unset (default) | **never stored**. Computed from `app.getVersion()`: a prerelease (`-beta.N`) build is **Beta**, otherwise **Stable** | setter **not called**. The build's `app-update.yml` already holds `channel: beta` for `-beta.N` builds (electron-builder `detectUpdateChannel`) and no channel for stable | constructor default (`true` for a prerelease version, else `false`) | stable: `latest.yml` / `latest-mac.yml` / `latest-linux.yml`; beta: `beta.yml` / `beta-mac.yml` / `beta-linux.yml` | `allowDowngrade = false` |
| Stable | yes (user choice) | `"latest"` (setter → `allowDowngrade=true`) | `false` | `latest*.yml` | `allowDowngrade = false` (last assignment) |
| Beta | yes (user choice) | `"beta"` (setter → `allowDowngrade=true`) | `true` | `beta*.yml` (stable builds also write these, so Beta users get stable releases) | `allowDowngrade = false` (last assignment) |

`allowPrerelease` only affects the GitHub provider. It is set anyway so the state reads consistently. Implementation: `spikes/s3-packaging/src/update-probe.ts` (`defaultChannelPref`, `applyChannelPref`).

## Evidence excerpts

**Node stub.** All of these are from run 43915218016:
- `Node stub hits in the builder logs` prints `node was called: 0` on macos-26, macos-26-intel, windows-latest, ubuntu-24.04, ubuntu-24.04-arm and windows-11-arm.
- `##[error]` annotations per job are 0 everywhere except macos-26-intel. There the single annotation is the icon-export step timeout, not a stub hit.
- Windows proof step: `where.exe node` → `D:\a\_temp\no-node\node`, `D:\a\_temp\no-node\node.exe`. `node --version -> (stub) node was called: --version (exit code 1)`.

**Feed log, NSIS gate** (windows-latest):
```
GET /feed/latest.yml?noCache=… 200
GET /feed/tinydocy-0.0.2-setup.exe 200
GET /feed/latest.yml?noCache=… 200        <- relaunched 0.0.2 (argv ["--updated"]), update-not-available
```
**Feed log, AppImage gate** (ubuntu-24.04):
```
GET /feed/latest-linux.yml?noCache=… 200
GET /feed/tinydocy-0.0.2-x86_64.AppImage 200
GET /feed/latest-linux.yml?noCache=… 200  <- relaunched 0.0.2
```
**Feed log, beta offered stable** (ubuntu-24.04): `beta-linux.yml` → `tinydocy-0.0.4-x86_64.AppImage 200` → `latest-linux.yml` (from 0.0.4).
**Feed log, macOS x64** (macos-26-intel): `latest-mac.yml` → `tinydocy-0.0.2-mac-x64.zip 200`.

**`allowDowngrade` log, Beta→Stable vs a 0.0.0 feed** (ubuntu-24.04):
```
v0.0.3-beta.1 after construction allowDowngrade=false channel=null allowPrerelease=true
v0.0.3-beta.1 after channel setter (pref=stable) allowDowngrade=true channel=latest allowPrerelease=true
v0.0.3-beta.1 before checkForUpdates allowDowngrade=false channel=latest allowPrerelease=false
v0.0.3-beta.1 [updater] Update for version 0.0.3-beta.1 is not available (latest version: 0.0.0, downgrade is disallowed).
```
**Negative control** (reset skipped): `before checkForUpdates allowDowngrade=true … (negative control: reset skipped)` → `Found version 0.0.0` → relaunched `v0.0.0`.

**`latest-mac.yml`** (macos-26, 0.0.2; repeated entries trimmed): files `tinydocy-0.0.2-mac-x64.zip` (123,312,545), `tinydocy-0.0.2-mac-arm64.zip` (119,316,771; ×3), `tinydocy-0.0.2-x64.dmg` (×3), `tinydocy-0.0.2-arm64.dmg` (×3); `path: tinydocy-0.0.2-mac-x64.zip`. Full files: [`latest-mac.yml`](spike-evidence/s3/latest-mac.yml) (run 1) and [`latest-mac.yml-macos-26-intel`](spike-evidence/s3/latest-mac.yml-macos-26-intel) (run 2).

**`beta.yml`** (windows, stable 0.0.4):
```
version: 0.0.4
files:
  - url: tinydocy-0.0.4-setup.exe
    sha512: bNRxWr94…mnQ==
    size: 121664048
path: tinydocy-0.0.4-setup.exe
```
**`beta-mac.yml`** (macos-26, stable 0.0.4): `version: 0.0.4`, one file `tinydocy-0.0.4-mac-arm64.zip` (119,316,770).
**`beta-linux.yml`** (stable 0.0.4): `version: 0.0.4`, files `tinydocy-0.0.4-x86_64.AppImage` (126,111,897, `blockMapSize: 135341`) and `tinydocy_0.0.4_amd64.deb` (×3, the same per-channel repeat); `path:` the AppImage.
**0.0.3-beta.1 `app-update.yml`:** `provider: generic`, `url: http://127.0.0.1:8787/feed/`, `channel: beta`, `updaterCacheDirName: tinydocy-updater`.

**`Info.plist` excerpt** (`release/0.0.2/mac-arm64/TinyDocy.app`, macos-26):
```
"CFBundleIconFile" => "icon.icns"
"CFBundleIconName" => "Icon"
"CFBundleIdentifier" => "plus.docs.tinydocy.spike"
"CFBundleShortVersionString" => "0.0.2"
"LSMinimumSystemVersion" => "13.0"
Resources: Assets.car 1752888, icon.icns 33773
```

**xprop** (run 2, xvfb, both AppImage and deb): `WM_CLASS(STRING) = "tinydocy", "TinyDocy"`. Run 1 (desktopName `tinydocy.desktop`): `"tinydocy", "tinydocy"`.

**xdg-mime** (after `apt-get install ./tinydocy_0.0.1_amd64.deb`):
```
XDG_CURRENT_DESKTOP=GNOME xdg-mime query filetype sample.tinydoc   -> application/x-tinydoc
XDG_CURRENT_DESKTOP=GNOME xdg-mime query default application/x-tinydoc -> tinydocy.desktop
(no desktop) filetype -> text/plain (file(1) fallback); default -> tinydocy.desktop
```

**AppImage sandbox** (renderer `/proc/<pid>/status`):

| Build | restrict=1 (runner default = desktop default) | restrict=0 (CI sysctl) |
|---|---|---|
| AppImage | starts; AppRun injected `--no-sandbox` (main argv `["--no-sandbox"]`); renderer **Seccomp 0** | argv `[]`; **Seccomp 2** |
| .deb | argv `[]`; **Seccomp 2** (AppArmor profile `/etc/apparmor.d/tinydocy` from postinst) | argv `[]`; Seccomp 2 |

AppRun (electron-builder 26.18.0 AppImage), lines 56–57:
```
if [ $HAVE_NO_SANDBOX -eq 0 ] && ! unshare -Ur true 2>/dev/null ; then
  NO_SANDBOX=(--no-sandbox)
```

## Decisions

1. **`bun electron-builder`: yes** (arch §3.1 step 3). It builds DMG+zip, NSIS, and deb+AppImage (x64 and arm64) with the Node stub on PATH, with zero `node` calls and **no node exception needed for any step**. electron-builder 26.18.0 detects Bun (`pm=bun`) and walks `node_modules` itself.
   - On Windows the verbatim sh stub is not enough proof, because CreateProcess never runs it. Pair it with a compiled `node.exe` stub (`bun build --compile`), as `spike-s3.yml` does. The D-A12 smoke/`desktop-smoke.yml` should copy that.
2. **Channel mapping:** use the table above.
   - The default is computed from the running version and never stored. The setter is called only for an explicit choice.
   - `allowDowngrade = false` is assigned after the setter, immediately before every `checkForUpdates`.
   - `generateUpdatesFilesForAllChannels: true` on every build, so Beta users receive stable releases (verified 0.0.3-beta.1 → 0.0.4).
   - Correction for the docs: the flag does *not* touch `allowDowngrade` at runtime; only the channel setter does.
3. **Linux manifest signing works:** a custom Provider verifies a detached Ed25519 signature over the exact bytes it parses, and a tampered manifest is refused before any download.
   - So plan §7's fallback "Linux shows **Download update**" is **not needed on technical grounds**. AppImage in-app update with signed manifests is viable.
   - Still needed before shipping: key custody (P3.x, the signing key lives with the owner/release env, like D35) and a decision on whether `.deb` users get in-app updates. The deb path calls `pkexec dpkg -i` on desktops; the owner checks the polkit prompt.
   - Keeping "Download update" for `.deb` only is a reasonable product choice, but signing does not force it.
4. **AppImage sandbox:** the pre-registered outcome holds. On Ubuntu 24.04 defaults (restrict=1) the AppImage runs **unsandboxed**: electron-builder's AppRun silently adds `--no-sandbox` and the renderer shows Seccomp 0. The `.deb` runs sandboxed via its AppArmor profile.
   - → `/download` says "`.deb` recommended on Ubuntu 24.04+". We never tell users to pass `--no-sandbox`, but note the AppImage launcher does it for them.
   - The owner's real-desktop check stays open.
5. **WM_CLASS / desktop identity:** set `desktopName: "TinyDocy.desktop"` and `StartupWMClass=TinyDocy`, keeping the installed file `tinydocy.desktop` and MIME `application/x-tinydoc`.
   - The owner's Wayland dock check decides whether to switch to `syncDesktopName: true`, which renames the file to `TinyDocy.desktop` and changes the xdg-mime default answer. That choice locks at the first signed Gate 3 build (D33).
6. **Forge fallback: not needed.** electron-builder covered every gate row on Bun with no node exception.
7. **macOS update and signing:** pending owner signing enrolment (D35); checked at Gate 3. Unsigned, Squirrel.Mac refuses the bundle (expected).
8. **Icons:**
   - `.icon` → `Assets.car` works with electron-builder 26.18.0 + Xcode 26.6 on macos-26 runners.
   - Ship `icon.icns` alongside via `extraResources` + `extendInfo.CFBundleIconFile`.
   - ICNS and ICO are packed by script (`make-icons.ts`), with `iconutil` only as the verifier.
   - The macos-26-intel `osascript` icon export hangs; run icon exports on Apple-silicon runners only.

## Other findings for P2.5 / P3

- **`latest-mac.yml` / `latest-linux.yml` repeat file entries**, once per channel, when `generateUpdatesFilesForAllChannels` is on (electron-builder 26.18.0). Harmless for electron-updater, but a signer/verifier, or anyone diffing manifests, should expect it.
- **The probe uses `disableDifferentialDownload = true`** so the gate rows test full downloads. Blockmap/Range behaviour is untested here; the feed logged no Range requests.
- **Bun `__dirname` in this bundle:** `Bun.build --target node --format cjs` kept `__dirname` as a runtime value here (`loadFile(join(__dirname, "..", "static", "index.html"))` works packaged), while S2 saw the source directory inlined in its `"type": "module"` package. Use `app.getAppPath()` either way.
- **`libfuse2t64` is missing on a stock 24.04 image:** the runner image lacks it and the workflow installs it before running the AppImage. Launching without it was not tried here; electron-builder's type-2 runtime expects `libfuse.so.2`. `/download` should mention it for AppImage users.
- **`kernel.apparmor_restrict_unprivileged_userns`** is already 1 on the GitHub ubuntu-24.04 image (20261111). The plan's sysctl step is required for any AppImage sandbox test in CI.
- **Linux manifest signatures must bind their context (P3.3).** The spike signs the bare manifest bytes. A valid old manifest, or one channel's manifest, could therefore be replayed in place of another. `allowDowngrade = false` stops a version going backwards, but not a stale or wrong-channel manifest. The production signer should sign an envelope that names the channel file, the feed URL, the version and an issue time. The provider then checks each against what it requested and the installed version. The feed is HTTPS on the owner's host (plan §8.3). An automated security review raised this on the spike code. It doesn't change any S3 row.

## Decision: spec lines this PR changes

- **Arch §3.1 step 3:** `bun electron-builder` is confirmed, and no step needs a `node` exception. On Windows the CI Node block also needs a compiled `node.exe` stub. The D-A12 smoke ([#88](https://github.com/docs-plus/editor/pull/88)) now has one.
- **Test strategy §4.1:** the "Verify in S3" list becomes the channel mapping table above. The `generateUpdatesFilesForAllChannels` claim is corrected: only the `channel` setter turns `allowDowngrade` on.
- **Plan §7 (desktop security):** signed Linux manifests work, so AppImage keeps in-app updates with a verified manifest. For `.deb`, whether to install in-app (`pkexec dpkg -i`) or show **Download update** waits on the owner's polkit check.
- **Plan §8.4 S3 row:** the result.
- **Brand §3 (icon table and the WM-class row) and §4.3 (Linux install copy, two DMGs):** electron-builder 26.18.0 with Xcode 26.6 compiles `.icon`, and `icon.icns` ships alongside. `desktopName: TinyDocy.desktop` gives the X11 class `TinyDocy`. On Ubuntu 24.04+, `.deb` is recommended because the AppImage runs unsandboxed there (AppRun adds `--no-sandbox` itself), and AppImage needs `libfuse2t64`. Two DMGs are confirmed.
- **Phase 1 spikes plan, S3 `allowDowngrade` row:** the same correction as test strategy §4.1.

## Issues filed

None yet. The owner-hardware and signing rows are already tracked by the plan's owner-prerequisites table and Gate 3. The manifest-envelope requirement is written into P3.3 here.
