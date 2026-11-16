# Spike S5: typing latency against Chrome, the commit arms (D-A1) and IME

Date: 2026-11-16. Plan: `docs/superpowers/plans/2026-11-16-phase-1-spikes.md`, Task S5.
Spike code: branch `spike/s5-latency` (the plan calls it `spike/s5-latency-ime`), directory
`spikes/s5-latency/`, workflow `.github/workflows/spike-s5.yml`. Throwaway; never merged.
Raw results: `docs/research/spike-evidence/s5/`.

## Recommendation (D-A1)

**Verdict: D-A1 keeps the storage worker.** `node:sqlite` stays in a `worker_thread` inside main,
and no storage commit runs on main's own thread.

**Is it provisional?** Only formally. The plan's rule keeps the worker unless commits on main pass
on both verdict machines. Those runs are pending owner hardware, so the worker is the decision
today. An owner run could reopen it only if all four main-thread ratios came in ≤ 1.10 with event
loop p99 ≤ 8 ms. On every machine measured here, main-thread commits fail: ratios 1.09–1.38,
worst p99 per machine 9.9–182 ms. Phase 2 can build on the worker now.

- The plan's rule lets commits move onto main only if all four `electron-main-commits` /
  `electron-idle` p95 ratios (50 and 500 headings, on the owner's M1 and on a Windows laptop with
  Defender on) are ≤ 1.10 **and** main's event-loop-delay p99 is ≤ 8 ms in every one of those
  runs. Both verdict machines are **pending owner hardware**, so the rule cannot pass; "otherwise
  D-A1 keeps the worker". The owner-prerequisite fallback says the same: without the Windows
  laptop, D-A1 is decided on the Mac alone, keeping the worker.
- Every machine measured here points the same way. Main-thread commits fail at least one
  condition on all of them. The worker arm matches `electron-idle` on the quiet M5 Max and stays
  under 1.10 on `ubuntu-24.04`. It exceeds 1.10 on the 3–4 vCPU `macos-26` and `windows-latest`
  runners, where main-thread commits are worse still on the same runs:

| Machine | main / idle p95, 50 h | main / idle p95, 500 h | main ELD p99, worst run | worker / idle p95, 50 h / 500 h |
|---|---|---|---|---|
| M5 Max (local, context) | **1.38** | **1.12** | 7.2 ms / **9.9 ms** | 1.00 / 1.00 |
| `ubuntu-24.04` (hosted) | **1.21** | **1.20** | **33.2 ms** / **13.1 ms** | 1.07 / 1.09 |
| `macos-26` (hosted, noisy VM) | 1.09 | **1.13** | **11.1 ms** / **9.1 ms** | **1.18** / **1.17** |
| `windows-latest` (hosted) | **1.31** | pending: Windows runner time limit; rerun on owner hardware | **181.9 ms** / pending: Windows runner time limit; rerun on owner hardware | **1.13** / pending: Windows runner time limit; rerun on owner hardware |
| Owner M1 (verdict) | pending owner hardware | | | |
| Windows laptop, Defender on (verdict) | pending owner hardware | | | |

Ratios use the runner→renderer measure (below). Bold = fails the rule's threshold.

- Why the stall shows: the main-thread arm commits back to back on main, about 4 ms per commit
  with `fullfsync` on macOS. A key that arrives during a commit waits for it, so the
  runner→renderer p95 rises 3 ms at 50 headings (8 → 11 ms on the M5 Max), and main's event loop
  stalls up to 86 ms (M5 Max), 417 ms (`ubuntu-24.04`) or 664 ms (`windows-latest`). The renderer-side measure barely moves
  (1.04 at 50 headings): Review Focus #2, confirmed.

Spec lines this settles (to fold into the Phase 1 amendments): arch §1 D-A1 ("**Decided by
S2/S5** … If commits on main's own thread stay within budget, the worker is dropped") and the
design doc's D-A1 row → "Decided by S5: the worker stays." The worker's own pass row
(ratio ≤ 1.10 against idle) is measured on the M5 Max at 1.00 / 1.00; its verdict rows are also
pending owner hardware.

## The question

1. Is typing in Electron within 10% of Chrome on the `perf` spec (p95, 50 and 500 headings)?
2. D-A1: do storage commits on main's own thread keep typing within 10% of `electron-idle`, with
   main's event-loop-delay p99 ≤ 8 ms? Does the worker?
3. Does Japanese IME work in every block type on macOS, Windows and GNOME Wayland?

## Versions

| Component | Version |
|---|---|
| Electron | 45.3.2 (Chromium 156.0.8078.100, Node 24.22.2), S1's pin |
| Chrome for Testing | 156.0.8078.80 (latest CfT build of milestone 156; same major as Electron 45) |
| Playwright | root `@playwright/test` ^1.65.0 (`_electron` and `chromium.launch({ executablePath })`) |
| Bun | 1.4.4 |
| App | static export from `spike/s1-shell` (`bun spikes/s1-shell/build-export.ts`), Next.js 16.4.6 |
| Storage | `spike/s2-storage` engine, commit loop and worker, unchanged: WAL, `synchronous=FULL`, `fullfsync` + `checkpoint_fullfsync` on macOS, 4 KB rows |
| electron-builder | not used by S5 (unpackaged Electron) |
| Local machine | Apple M5 Max, 18 cores, 48 GiB, macOS 27.0.1 (26A434); **not** a verdict machine |
| `macos-26` | image macos-26-arm64 20261102.0473, Apple M1 (Virtual), 3 vCPU, 7 GiB, Darwin 25.6.0 |
| `ubuntu-24.04` | image 20261111.370, AMD EPYC 9V74, 4 vCPU, 16 GiB, kernel 7.0.0-1017-azure, Xvfb |
| `windows-latest` | image windows-2025-vs2026 20261103.298, Windows Server 2025 (10.0.26100), AMD EPYC 9V74, 4 vCPU, 16 GiB; Defender state not recorded |

## Method

- **Same document, same throttle.** `generateLargeDocument(n, { shape: "flat" })` once per size,
  loaded into every trial with `setContent`. CDP `Emulation.setCPUThrottlingRate` 4 on the
  renderer. 220 keystrokes ("a", 10 ms key hold, as `performance.spec.ts`), the first 20 dropped.
  p95 per trial, then the median of 7 rounds.
- **Five arms, interleaved.** Each round runs every arm once in a rotated order, each a fresh
  launch; one discarded warm-up trial per arm first.
  - `chrome`, `chrome-control`: two separate launches of Chrome for Testing, headed, 1280×720
    viewport, serving `out/` from `serve-out.ts` on `http://127.0.0.1`. Their ratio is the noise
    floor.
  - `electron-idle`, `electron-worker-commits`, `electron-main-commits`: S1's main unchanged
    (`app://tinydocy`, the desktop CSP, the sandboxed CJS preload), with S5's instrumentation
    imported first. Content size set to 1280×720. The same three anti-backgrounding switches
    Playwright gives Chrome are added to Electron.
  - The commit arms start S2's commit loop (back-to-back 4 KB commits, yielding with
    `setImmediate` between commits) just before typing, in S2's worker or on main itself, and
    stop it after the last key. Commits per second are recorded.
- **Two measures per keystroke, both recorded in every arm.**
  - *Observer*: `perf-observer.ts`'s `injectKeystrokeTimer` (keydown `timeStamp` → input-event
    microtask). Used for Electron vs Chrome.
  - *Runner→renderer*: the runner's `Date.now()` just before it sends each key → the renderer's
    `Date.now()` in the input-event microtask (one machine clock). CDP keys are stamped when
    main hands them on, so only this measure sees a stall on main. Used for the commit arms.
- **Main's event loop.** `perf_hooks.monitorEventLoopDelay({ resolution: 1 })`, reset and enabled
  per trial while typing, p99 and max in ms. Sanity check per run: a deliberate 50 ms busy-wait on
  main reads as max 50.9–51.1 ms (51.8 ms on `windows-latest`, 89.7 ms on the noisy `macos-26`
  VM). The histogram records the whole interval between samples, so an idle loop reads about
  1.1–1.7 ms; values are reported as recorded (conservative by up to
  1 ms against the 8 ms limit).
- **Servers.** Loopback `bun scripts/hocus-server.ts` with a temp `DB_PATH`, `HOCUS_THROTTLE=0`,
  `HOCUS_ALLOW_ISOLATED_TABS_DOCS=1`, origins `http://127.0.0.1:3900` and `app://tinydocy`, and
  production's `MAX_DOC_SIZE_BYTES=2097152`. Never the live site.
- **Checks per trial.** Exactly 220 samples in both measures; `document.visibilityState` visible
  and the document focused (true in every trial); the 1-minute load average is logged.

Run it: `bun spikes/s1-shell/build-export.ts` (with `NEXT_PUBLIC_SPIKE_EXPOSE_EDITOR=1`,
`NEXT_PUBLIC_HOCUS_URL=ws://127.0.0.1:1290`), `cd spikes/s5-latency && bun install &&
bun run build`, then `CHROME_PATH=<CfT 156> bun spikes/s5-latency/run.ts`.

## Results

Workflow run: https://github.com/docs-plus/editor/actions/runs/43917773107 (commit `44fe815`).
Every trial completed on the first attempt (no retries). The `windows-latest` job hit the
workflow's 150-minute limit. It finished all 7 rounds at 50 headings, then was cancelled during
the first 500-heading round: Electron's close timed out on every Windows launch (10 s each), and
500-heading trials are slow. Its 500-heading rows are "pending: Windows runner time limit; rerun
on owner hardware".

| Row | Gate-blocking | Result | Where |
|---|---|---|---|
| Electron within 10% of Chrome (`electron-idle` / `chrome`, observer p95, 50 and 500 h) | no | **pending owner hardware** (verdict machines). Context: M5 Max 1.03 / 1.07 (noise 0.97 / 1.05), `ubuntu-24.04` 1.18 / 0.98 (noise 1.06 / 1.01), `macos-26` 1.60 / 1.34 (noise 1.12 / 0.93), `windows-latest` 0.93 (noise 0.96) / pending: Windows runner time limit; rerun on owner hardware | all |
| Noise floor (`chrome-control` / `chrome`) reported next to each verdict | no | reported in every table | all |
| Electron and Chrome for Testing versions recorded | no | 45.3.2 / Chromium 156.0.8078.100 vs CfT 156.0.8078.80 | all |
| `electron-worker-commits` / idle ≤ 1.10 | no | **pending owner hardware**. Context: M5 Max 1.00 / 1.00, `ubuntu-24.04` 1.07 / 1.09, `macos-26` 1.18 / 1.17, `windows-latest` 1.13 / pending: Windows runner time limit; rerun on owner hardware | all |
| Main-thread commits: four ratios ≤ 1.10 and ELD p99 ≤ 8 ms | no (decides D-A1) | **not met → keep the worker** (verdict machines pending; fails on every machine measured) | all |
| Commits per second | no | M5 Max ≈ 255–265 (both arms); `macos-26` worker 735–771, main 604–610; `ubuntu-24.04` worker 3,472–4,280, main 2,573–2,943; `windows-latest` (50 h) worker 225, main 236 | all |
| Japanese IME, macOS and Windows | no | **pending owner hardware** (`spikes/s5-latency/ime-checklist.md`) | — |
| CJK IME on GNOME Wayland (IBus + Mozc; XWayland fallback) | no | **pending owner hardware** | — |

### Per machine (median of 7 rounds of per-trial p95, ms)

Observer / runner→renderer. ELD = main's event-loop delay p99, median of rounds (worst round).

**M5 Max, local (context; shared with other sessions, load average 7–16):**

| Arm | 50 h | 500 h | ELD p99, 50 h | ELD p99, 500 h |
|---|---|---|---|---|
| chrome | 6.8 / 8 | 46.9 / 48 | — | — |
| chrome-control | 6.6 / 7 | 49.2 / 50 | — | — |
| electron-idle | 7.0 / 8 | 50.1 / 51 | 1.6 (2.1) | 1.8 (2.2) |
| electron-worker-commits | 7.0 / 8 | 50.7 / 51 | 1.8 (2.2) | 1.8 (2.3) |
| electron-main-commits | 7.3 / 11 | 54.3 / 57 | 6.9 (7.2) | 7.0 (9.9) |

**`ubuntu-24.04` (hosted, 4 vCPU, Xvfb):**

| Arm | 50 h | 500 h | ELD p99, 50 h | ELD p99, 500 h |
|---|---|---|---|---|
| chrome | 10.7 / 12 | 86.1 / 89 | — | — |
| chrome-control | 11.3 / 12 | 87.2 / 89 | — | — |
| electron-idle | 12.6 / 14 | 84.4 / 85 | 1.8 (2.2) | 1.2 (1.3) |
| electron-worker-commits | 13.2 / 15 | 92.5 / 93 | 1.9 (2.0) | 1.4 (1.5) |
| electron-main-commits | 13.6 / 17 | 96.7 / 102 | 10.8 (33.2) | 8.3 (13.1) |

Main's event loop max under main-thread commits: 371 ms (50 h) and 417 ms (500 h).

**`macos-26` (hosted, 3 vCPU virtual M1):** too noisy to inform a verdict. Rounds of one arm span
2× (Chrome 13–33 ms at 50 h, 69–172 ms at 500 h) and the noise floor is 1.12 / 0.93.

| Arm | 50 h | 500 h | ELD p99, 50 h | ELD p99, 500 h |
|---|---|---|---|---|
| chrome | 19.6 / 21 | 110.8 / 113 | — | — |
| chrome-control | 21.9 / 23 | 102.5 / 105 | — | — |
| electron-idle | 31.3 / 33 | 148.0 / 150 | 5.9 (8.0) | 4.1 (4.8) |
| electron-worker-commits | 33.7 / 39 | 171.1 / 175 | 4.7 (15.4) | 4.3 (4.7) |
| electron-main-commits | 32.5 / 36 | 165.8 / 169 | 8.7 (11.1) | 6.6 (9.1) |

**`windows-latest` (hosted, Windows Server, Defender state unknown):**

| Arm | 50 h | 500 h | ELD p99, 50 h |
|---|---|---|---|
| chrome | 13.8 / 17 | pending: Windows runner time limit; rerun on owner hardware (one round: 114.2 / 117) | — |
| chrome-control | 13.2 / 16 | pending: Windows runner time limit; rerun on owner hardware (one round: 117.4 / 120) | — |
| electron-idle | 12.9 / 16 | pending: Windows runner time limit; rerun on owner hardware (one round: 112.2 / 115) | 4.0 (6.7) |
| electron-worker-commits | 14.7 / 18 | pending: Windows runner time limit; rerun on owner hardware | 4.2 (6.4) |
| electron-main-commits | 15.2 / 21 | pending: Windows runner time limit; rerun on owner hardware | 21.9 (181.9) |

Main's event loop max under main-thread commits: 664 ms. Every main-thread round's ELD p99 was
19–182 ms, against the 8 ms limit. The runner has no load average (`os.loadavg()` is 0 on
Windows), and its Defender state is unknown, so it isn't the plan's Defender-on laptop.

## Reading the numbers

- **Main-thread commits are visible only end to end.** On the M5 Max the observer p95 under
  main-thread commits is 1.04 × idle at 50 headings, but the runner→renderer p95 is 1.38 ×. A
  renderer-only budget would have passed commits on main.
- **The worker costs nothing measurable on a quiet machine** (1.00 / 1.00 on the M5 Max). On the
  hosted runners it costs 7–18%: 7–9% on the 4-vCPU Linux runner, where it commits 3,500–4,300
  times a second (no `fullfsync`, a fast disk), 13% on `windows-latest` and 17–18% on the
  3-vCPU `macos-26` VM. A flat-out commit loop competes for the runner's few cores. Real commits
  are far rarer (debounced Yjs updates), so these are upper bounds. Main-thread commits cost more
  on every one of those runs.
- **Electron vs Chrome.** On the M5 Max Electron is within 3–7% of Chrome, inside a 3–5% noise
  floor. On `ubuntu-24.04` it is 18% slower at 50 headings (noise 6%) and 2% faster at 500. On the
  `macos-26` VM Electron is 34–60% slower, well past its noise floor. That gap is plausibly the
  VM's virtual GPU treating the two compositors differently, but the run can't tell; the owner's
  M1 decides it.
- **Quantization.** `Date.now()` is whole milliseconds, so at 50 headings one step is 12–14% of
  the p95. The main-thread gap (8 → 11 ms on the M5 Max) is three steps. Comparisons inside one
  step at 50 headings (e.g. `chrome-control` 7 vs `chrome` 8 ms) are not meaningful.
- **Not identical environments.** The Chrome arms load `out/` over `http://127.0.0.1` without the
  desktop CSP; the Electron arms load it on `app://tinydocy` with S1's CSP and preload. That is the
  real difference between the two products, so it stays in the comparison. Spellcheck is on in
  both (Electron's default, S1's setting; Chrome's default).
- **Load on the local machine.** The M5 Max ran with many parallel sessions (load average 7–16 on
  18 cores). The interleaving spreads that over every arm, and the noise floor stays at 0.97–1.05,
  but it is context, not a verdict.

## Findings for other spikes

- **S1:** `build-export.ts` fails on `windows-latest`: `renameSync` from `D:\a\…\app\sitemap.ts`
  into `os.tmpdir()` on `C:` throws `EXDEV`. S5 sets `TMP`/`TEMP`/`TMPDIR` to `runner.temp` on
  that step; the script could park the files inside the checkout instead.
- **S1 / S4:** after typing, `electronApp.close()` often never resolves (Electron doesn't exit
  within 10 s): with the 500-heading document on macOS and Linux, and on every launch on
  `windows-latest`, 50 headings included. On macOS at 50 headings it closes normally. S5 kills the process after
  measuring. Worth a look in S4's relaunch flow.
- **Harness:** the 500-heading document (about 1.2 MB as JSON) is over Hocus's default
  `MAX_DOC_SIZE_BYTES` (1 MiB); the editor turns read-only and no keystroke lands. The nightly
  `perf` budget at 500 headings needs production's 2 MiB cap.
- **Harness:** Bun.build inlines `__dirname` as the source directory, so the worker path comes
  from `app.getAppPath()` (S1 found the same).

## Evidence

- `docs/research/spike-evidence/s5/`: one JSON per machine and size (every trial: both p95s,
  main's event-loop p50/p99/max, commits per second, load average, visibility, versions).
- Workflow run: https://github.com/docs-plus/editor/actions/runs/43917773107 (artifacts
  `s5-latency-<os>`, 30 days).
- IME: `spikes/s5-latency/ime-checklist.md` on the spike branch, to be ticked by a person.

## Pending owner hardware

- The latency verdicts (Electron vs Chrome, worker, main-thread commits) on the owner's M1 and on a
  Windows laptop with Defender on (`Get-MpComputerStatus` recorded). Commands are in
  `ime-checklist.md`. They can't move D-A1 off the worker unless all four main-thread ratios pass.
- Japanese IME on macOS and Windows 11, and IBus + Mozc on Ubuntu 24.04 GNOME Wayland (with the
  XWayland fallback and a fractional-scaling screenshot if native Wayland fails).

## Issues to open (P2.5)

Not filed by this spike; the lead files them with the amendments.

- Windows typing verdict (Electron vs Chrome, Defender on): pending the owner's laptop (plan's
  owner-prerequisite fallback).
- IME rows on macOS, Windows and GNOME Wayland: carried to P2.5 if the owner session doesn't run
  before Gate 1.
- Investigate Electron's 34–60% gap to Chrome on the `macos-26` VM if the owner's M1 shows any
  part of it.
