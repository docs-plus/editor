# Spike: building the desktop renderer on Windows (#103, #111)

- **Date:** 2026-11-17
- **Issues:** docs-plus/editor#103 (segment-prefetch path on Windows), docs-plus/editor#111 (`EXDEV` in `build-export.ts`)
- **Spike branch (never merged):** `spike/windows-export`, branched from `spike/s1-shell`. Code in [`spikes/windows-export/`](https://github.com/docs-plus/editor/tree/spike/windows-export/spikes/windows-export) and `spikes/s1-shell/build-export.ts`; workflow `.github/workflows/spike-windows-export.yml`.
- **Runs:** canonical [44041439341](https://github.com/docs-plus/editor/actions/runs/44041439341) (`98679c0`), all 10 jobs green; rerun after the probe fix: RERUN_PLACEHOLDER.
- **Evidence:** `docs/research/spike-evidence/windows-export/`.
- **Decisions:**
  - **#103:** **(a)**: build the renderer once, on Linux, and package those same bytes on every OS. The protocol handler maps no names. The stage step fails on any `__next.*` directory, so a Windows-built renderer can't be packaged.
  - **#111:** **fixed** on the spike branch. The files are parked inside the checkout; that commit was 635e961 on `spike/s1-shell`, and this spike adds recovery from an interrupted run. Proved on `windows-latest` with the default temp dir. **The overlay stays in Phase 2.** A build-time flag alone can't replace it (§3.3).
  - **Upstream:** already tracked as vercel/next.js#85374 (open), with two unreviewed fix PRs. The draft is a comment for that issue, plus a full report as a fallback: [`nextjs-upstream-report.md`](spike-evidence/windows-export/nextjs-upstream-report.md). Not posted.

## 1. Questions

1. Does Next.js's static export really write segment-prefetch files under a different path on Windows? Does that happen in a minimal app too, not just TinyDocy, and does a newer Next fix it?
2. Should releases build the renderer on Linux or macOS, or should the `app://` protocol handler map the Windows path to the one the client requests?
3. Does parking the web-only metadata files inside the checkout fix `EXDEV` on Windows runners, without a TMP/TEMP override?
4. Should Phase 2 keep that move-aside ("overlay"), or replace it with the desktop build flag?

## 2. Versions

| Component | Version |
|---|---|
| Next.js | 16.4.6 (`latest`, Turbopack) and 16.5.0-canary.49. Canary.49 was the newest canary older than the repo's 3-day `minimumReleaseAge` on 2026-11-17. The source of canary.53 (2026-11-16) was read, not run. |
| React | 19.3.1 |
| Bun | 1.4.4 (`.tool-versions`); `next` runs on Bun (`[run] bun = true`), with the Node stub on PATH |
| Windows runner | `windows-latest` = `windows-2025-vs2026` image 20261103.298.1, Windows Server 2025 Datacenter. The checkout is on `D:`, the temp dir on `C:`. |
| Linux / macOS runners | `ubuntu-24.04`, `macos-26` |

## 3. Results

### 3.1 #103: the Windows segment layout

A minimal app ([`spikes/windows-export/repro/`](https://github.com/docs-plus/editor/tree/spike/windows-export/spikes/windows-export/repro)) has a root layout, `/` with a `<Link href="/about">`, and `/about`, with `output: "export"` and nothing else. It was exported on 3 OSes × 2 Next versions. [`check-segments.ts`](https://github.com/docs-plus/editor/blob/spike/windows-export/spikes/windows-export/check-segments.ts) lists the segment files. It then requests the URLs the client router asks for from a plain static server, which maps a path straight to a file (as any host does).

| Build OS | Next | Page segment files | `GET /about/__next.about.__PAGE__.txt` | `GET /_not-found/__next._not-found.__PAGE__.txt` |
|---|---|---|---|---|
| `ubuntu-24.04` | 16.4.6 | flat | 200 | 200 |
| `ubuntu-24.04` | 16.5.0-canary.49 | flat | 200 | 200 |
| `macos-26` | 16.4.6 | flat | 200 | 200 |
| `macos-26` | 16.5.0-canary.49 | flat | 200 | 200 |
| **`windows-latest`** | **16.4.6** | **nested:** `about/__next.about/__PAGE__.txt`, `_not-found/__next._not-found/__PAGE__.txt` | **404** | **404** |
| **`windows-latest`** | **16.5.0-canary.49** | **nested** (same two) | **404** | **404** |
| `windows-latest`, full TinyDocy desktop export | 16.4.6 | nested (same two) | 404 | 404 |

Raw: `check-segments-results.jsonl` (one line per job), `repro-out-listing.txt` (`find out -name '*.txt'` on Windows and Linux).

- **The client asks for the dotted name.** In S1's canonical run, Electron on Windows listed `/about/__next.about.__PAGE__.txt?_rsc=…` in `notFoundBeforeProbes`, next to `/privacy` (run [43920568081](https://github.com/docs-plus/editor/actions/runs/43920568081), Windows job). The client builds the name with `convertSegmentPathToStaticExportFilename`, from a segment path joined with `/`.
- **What it costs:** the segment prefetch for every route below the root. S1 saw navigation fall back to the full payload (`about.txt`) without a document load. So nothing breaks, but each prefetch is a wasted request and a 404 in the protocol handler.
- **Cause (Next source, 16.4.6 and canary.53 alike):** `collectSegmentPathsImpl` in `packages/next/src/export/index.ts` returns `path.relative(segmentsDirectory, …)`. On Windows that is `about\__PAGE__.segment.rsc`. `convertSegmentPathToStaticExportFilename` replaces only `/` with `.`, so the backslash survives, and `path.join(segmentsDirDest, filename)` turns it into a directory. The root route's `__next.__PAGE__.txt` is unaffected, because its segment has no parent directory.
- **Newer Next:** not fixed. Canary.49 reproduces on the runner. In canary.53 (2026-11-16, the newest when checked) both functions are unchanged.
- **Upstream:** vercel/next.js#85374 has been open since 2025-10-26, with the same root cause in its latest comment. vercel/next.js#92339 was closed as its duplicate on 2026-08-31. Fix PRs #92340 (2026-04-04) and #99058 (2026-09-22) are open and waiting for review.

### 3.2 #103: option (a) works: one Linux build, packaged on every OS

The workflow's `handoff-build` job exports TinyDocy's renderer on `ubuntu-24.04` and writes a sha256 manifest. It uploads `out/` and the manifest with `actions/upload-artifact`. `handoff-check` downloads them on `windows-latest` and `macos-26`.

| Downloaded on | Files | Manifest | Segment layout | Both client URLs |
|---|---|---|---|---|
| `windows-latest` | 132 | identical | flat | 200 |
| `macos-26` | 132 | identical | flat | 200 |

Raw: `handoff.txt`. The artifact hop keeps every name and byte, including the `$`, `!` and `@` that Next's segment encoding can use.

### 3.3 #111: `EXDEV` fixed, and the overlay stays

**The fix.** `spikes/s1-shell/build-export.ts` already parked the five web-only metadata files in `spikes/s1-shell/.parked/` (commit 635e961 on `spike/s1-shell`). S5 hit `EXDEV` because its branch still had the older `mkdtempSync(tmpdir())` version. This spike adds two things:
- A log line with the drive of the repo, the parking folder and `os.tmpdir()`.
- Recovery: files an interrupted run left in `.parked/` go back to `app/` before anything moves. Without this, the next run would skip them, because they no longer exist in `app/`, and the next web build would silently ship without its sitemap, robots and manifest. Tested locally: with `app/robots.ts` parked by hand, the next run restored it and exported.

**The proof** (`exdev` job, `exdev-windows.txt`): no TMP/TEMP override is set, and Bun's `os.tmpdir()` is the Windows default.

| Step | Result |
|---|---|
| Checkout drive vs `os.tmpdir()` | `D:\` vs `C:\Users\RUNNER~1\AppData\Local\Temp` (the job fails if they're the same drive, since then nothing would be proved) |
| Control: `renameSync` from the checkout to `mkdtempSync(os.tmpdir())`, the old code path | `EXDEV` |
| `bun spikes/s1-shell/build-export.ts` | `exit=0` in 32.9 s; parked on `D:\`; no web-only metadata in `out/` |
| `git status --porcelain -- app` afterwards | empty |

**Overlay or build flag** (`force-static-experiment.txt`, macOS, Next 16.4.6). The question was whether the desktop build flag could replace moving files around. Two builds of the spike tree, without the overlay:
- **Files left as they are:** the export fails. `/robots.txt`, `/sitemap.xml` and `/manifest.webmanifest` have no `dynamic = "force-static"`, which `output: "export"` requires.
- **With `export const dynamic = "force-static"` on the five files:** the export passes. But every desktop page then carries `<link rel="manifest" href="/manifest.webmanifest">`, `og:image` and `twitter:image` pointing at `https://tiny.docs.plus/opengraph-image`, and `<link rel="apple-touch-icon">`. File-convention metadata injects those tags; no config turns them off. Deleting the files from `out/` afterwards would leave the tags pointing at files that don't exist: a 404 at every launch, like the `/privacy` one in S1.

Turbopack ignores `pageExtensions` for metadata files (S1), so `sitemap.web.ts` isn't an option either. **The move-aside stays in Phase 2**, with these rules:
- Park inside the checkout, never in `os.tmpdir()`.
- Restore leftovers first.
- Restore in `finally`.
- Fail if a file exists both in `app/` and in the parking folder.

The desktop build flag (`NEXT_PUBLIC_APP_TARGET=desktop`, which the desktop-seams work is defining on `main`) still picks `output: "export"` and `pageExtensions`. The overlay runs inside the same desktop build script. The two don't compete.

One risk remains, a Windows file lock: a dev server or editor holding `app/sitemap.ts` open could make the rename fail with `EPERM`/`EBUSY`. Releases build on Linux (§4), so this only touches a developer packaging locally on Windows, and the script fails loudly there.

## 4. Decision for #103: (a) build once on Linux

**(a) Build the renderer once on Linux (or macOS) and package it on each OS.** Recommended.
- **Reproducibility:** every installer in a release carries byte-identical renderer files. One sha256 manifest describes the renderer of all three OSes, and one build provenance covers it (test-release strategy §1.10, supply chain). With per-OS builds, the three renderers would differ, by more than this bug: chunk hashes, file layout, whatever comes next.
- **Signing:** nothing changes. The signing job still installs nothing and signs what the packaging jobs built (strategy §2.4). The renderer is data inside `app.asar`. Each OS's packaging job builds the asar. The macOS code signature covers it there, and so does Electron's asar integrity hash if that fuse is on. A renderer built elsewhere is no different to them from one built in place.
- **Pipeline:** one more job and an artifact hop in `release-desktop.yml` and `nightly-desktop.yml`, using the actions the repo already pins (`upload-artifact` v7.0.2, `download-artifact` v8.0.2). It also saves two `next build` runs per pipeline, the macOS and Windows ones, on the slowest runners. The renderer bakes in nothing host-specific: platform detection is runtime-only (`navigator.userAgentData` in `lib/shortcuts.ts`, `process.platform` in main).
- **Guard:** the stage step fails on any `__next.*` directory in `out/`. `findNestedSegmentDirs` in `check-segments.ts` is the 20-line version.

**(b) Map the slashed path to the dotted name in the `app://` protocol handler.** Rejected.
- It puts a workaround for a build bug into the security-sensitive path resolver. The handler already has a traversal fuzz suite (strategy §1.3), and every rewrite rule widens what it has to prove.
- The Windows package would still contain a different renderer from the other two, so the reproducibility point above is lost.
- It needs a removal plan once upstream merges, and it silently hides any other Windows-only export difference.
- It only helps the packaged app. A Windows-built `out/` on any other host still 404s.

**When upstream fixes it** (#92340 or #99058 lands in a pinned Next): Windows may export again, but the single Linux build stays, for the identical bytes. The guard stays as a regression check.

## 5. Spec changes (in this PR)

- **Desktop architecture §3.1:**
  - step 1 records the in-checkout parking, the leftover recovery and why the overlay stays, plus the "built once, on Linux" rule;
  - step 3 adds the `__next.*` guard.
- **Test and release strategy §2.4:** a new "On the renderer" block:
  - Windows never runs the desktop `next build`;
  - `release-desktop.yml` and `nightly-desktop.yml` export once on Linux, hand over `out/` with a sha256 manifest, and check it before staging;
  - `electron-mac` may export on its own macOS runner;
  - when to revisit.

## 6. Follow-ups

- **Owner:** post the #85374 comment from the draft, or not. If posted, also ask for review on #99058. A new issue is the fallback only, and it needs a public repro repository (owner TBD).
- **P2.5 desktop build script (desktop-seams, then P2.5):** carry the overlay rules from §3.3, and the `__next.*` stage guard.
- **P3.1 `release-desktop.yml`:** the Linux renderer job and the manifest check in each packaging job.
