# Spike S2: `node:sqlite` storage worker, crash atomicity, durability evidence

- **Date:** 2026-11-16
- **Plan:** [Phase 1 spikes](../superpowers/plans/2026-11-16-phase-1-spikes.md), Task S2
- **Branch:** `spike/s2-storage` (`spikes/s2-storage/`, never merged). Workflow: `.github/workflows/spike-s2.yml`.
- **Run:** [43909325904](https://github.com/docs-plus/editor/actions/runs/43909325904) (commit `a3c9658`), 30 jobs: 6 runners × 5 targets.
- **Result:** every gate-blocking row passes. D-A1 is not decided here (S5's commit-arm rule decides it).

## The question

Can the desktop app keep its library in `node:sqlite` inside an Electron `worker_thread` with WAL, `synchronous=FULL` and `fullfsync`, and does a process kill at any moment leave the database consistent, with every acknowledged commit present and compactions all-or-nothing? Does `fullfsync` really reach the drive on a real Mac?

## Versions

| | |
|---|---|
| Electron | 45.3.1 (the shell spikes and the S6 smoke pin 45.3.2, a later patch of the same line) |
| Chromium | 156.0.8078.96 |
| Node (bundled) | 24.22.2 |
| SQLite (`node:sqlite`) | 3.53.4 |
| Yjs | 13.6.33 (the root's) |
| Bun | 1.4.4 (`Bun.build` → CJS `main.cjs` and `worker.cjs`) |
| Hosted runner images | `macos-26-arm64` 20261028.624, `macos-26` (Intel) 20260819.586, `windows-2025-vs2026` 20261103.298 (`windows-latest`), `windows-11-vs2026-arm64` 20261111.635, `ubuntu-24.04` and `ubuntu-24.04-arm` 20261103.629 |
| Owner Mac | MacBook Pro, Apple M5 Max, macOS 27.0.1 (26A434), internal APFS SSD |

This M5 Max is the owner's own Apple-silicon Mac. The plan wrote "M1" for that machine, and **the coordinator accepted this measurement as the owner-Mac durability evidence** (2026-11-16), so Gate 1 doesn't wait on another Mac. The F_FULLFSYNC path is the same on every Apple-silicon generation: the SoC storage controller under APFS.

## How it works

- `engine.ts` holds the schema (`docs`, `snapshots(doc_id, seq, data)`, `updates(doc_id, seq, origin, data)`), the pragmas (WAL, `synchronous=FULL`, and on macOS `fullfsync=1` and `checkpoint_fullfsync=1`), `appendBatch` (one `BEGIN IMMEDIATE … COMMIT` per batch) and `compact` (`BEGIN; UPSERT snapshots; DELETE updates WHERE doc_id = ? AND seq <= X; COMMIT`). The worker writes `ACK <seq>` and `COMPACT_ACK <seq>` to fd 1 with `writeSync` only after `COMMIT` returns, and `BATCH_BEGIN` / `COMPACT_BEGIN` before `BEGIN`.
- `gen.ts` is a deterministic Yjs edit generator: edit `seq` depends only on `(seed, seq)` and the text before it, with client id 1. Electron main and the Bun harness share it, so the harness rebuilds the exact reference for any `seq`.
- `kill-harness.ts` (Bun) launches the real Electron binary (`require("electron")`, never the `electron` bin wrapper), in `--mode=churn`, and SIGKILLs it (`TerminateProcess` on Windows). Append target: a random 50–2000 ms after `READY` (database loaded, churn starting). Compaction target: a random 0–20 ms after `COMPACT_BEGIN`, on a 5 MB document. After each kill it waits for `proc.exited`, asserts the pid is gone (`process.kill(pid, 0)` → `ESRCH`; `tasklist` on Windows), then reopens the database in a `--mode=verify` Electron and checks: `quick_check` = `ok`; the highest persisted `seq` ≥ the highest `ACK` read; rows contiguous from the snapshot's `seq + 1` (so a compaction is fully before or fully after); the rebuilt text hash and state vector equal the reference.
- Churn batches edits like the product: flush 250 ms after the last edit, at most 1 s after the first. Edits come in bursts 2–10 ms apart with pauses of 260–400 ms.

## Results

Gate rows run on `macos-26`, `windows-latest` and `ubuntu-24.04`; the other runners are informational. All 30 jobs of run 43909325904 passed.

| Row | Gate-blocking | Result | Where |
|---|---|---|---|
| The worker opens the library | no | **Pass.** `require("node:sqlite")` loads in a `worker_thread`. Read-back on every runner: `journal_mode` `wal`, `synchronous` `2`; on macOS also `fullfsync` `1`, `checkpoint_fullfsync` `1`. | 6 runners + owner Mac |
| Appends and compaction work | no | **Pass.** A batch with a duplicate `seq` rolls back whole (one transaction). A 10 ms edit stream flushes at the 1 s cap (≈1000, 2000 ms); a lone edit flushes 250–254 ms later. A 5.26 MB snapshot compaction covering `seq` X commits in 45–62 ms on the gate runners (30 ms on the owner Mac; 1.37 s on `windows-11-arm`). Snapshot + rows `seq > X` rebuild a Y.Doc equal to the reference (text and state vector). | 6 runners + owner Mac |
| Crash atomicity during append | **yes** | **Pass.** 200 kills per runner, 0 lost acked rows, 0 `quick_check` failures, 0 gaps, 0 reference mismatches. | see table below |
| Crash atomicity during compaction | **yes** | **Pass.** ≥ 100 of 200 kills inside a compaction on every gate runner (200, 200, 167); state always fully before or fully after; 0 failures. | see table below |
| Control with `synchronous=OFF` | no | **Passes, as expected.** 200 kills, 0 lost acked rows: the page cache survives a process kill, so the kill rows prove atomicity, not durability. The harness is not suspect. | see table below |
| Durability evidence | **yes** | **Pass** (owner-Mac evidence, accepted). Owner Mac (M5 Max), `fullfsync` on: 4 KB commit p50 **4.0 ms**, p95 6.2 ms, max 16.9 ms (2,000 commits). Plain `fsync` (`fullfsync=0`): p50 0.13 ms. `synchronous=OFF`: p50 0.03 ms. A p50 ≥ 1 ms with `fullfsync` against ≈0.1 ms without it shows F_FULLFSYNC reaches the drive. | owner Mac |
| Typing during commits | — | **Not here.** S5's `electron-worker-commits` and `electron-main-commits` arms; S2 provides `startCommitLoop` and the worker's `loop-start` / `loop-stop` for them. | S5 |
| Fallback `better-sqlite3` | — | **Not needed.** No `node:sqlite` row failed. | — |

### Kill harness, per runner (run 43909325904)

`kills inside` counts kills whose last protocol line was `BATCH_BEGIN` (append) or `COMPACT_BEGIN` (compaction) with no matching ack. Before/after: the reopened snapshot is the old one or the new one.

| Runner | Append: kills / after first ack / inside a batch | Compaction: kills / inside / before–after | `synchronous=OFF`: kills | Dense append (extra): kills / inside | Lost acked rows, `quick_check` failures, gaps, mismatches |
|---|---|---|---|---|---|
| `macos-26` | 200 / 166 / 4 | 200 / 200 / 172–28 | 200 | 100 / 1 | 0, 0, 0, 0 |
| `windows-latest` | 200 / 163 / 25 | 200 / 200 / 157–43 | 200 | 100 / 9 | 0, 0, 0, 0 |
| `ubuntu-24.04` | 200 / 183 / 0 | 200 / 167 / 112–55 | 200 | 100 / 0 | 0, 0, 0, 0 |
| `macos-26-intel` (info) | 200 / 170 / 15 | 200 / 200 / 200–0 | 200 | 100 / 5 | 0, 0, 0, 0 |
| `windows-11-arm` (info) | 200 / 172 / 4 | 200 / 200 / 200–0 | 200 | 100 / 2 | 0, 0, 0, 0 |
| `ubuntu-24.04-arm` (info) | 200 / 173 / 2 | 200 / 200 / 125–75 | 200 | 100 / 1 | 0, 0, 0, 0 |
| Owner Mac (M5 Max) | 400 (two runs) / 359 / 8 | 200 / 200 / 165–35 | 200 | 100 / 4 | 0, 0, 0, 0 |

Notes:
- Commits are short next to the 250 ms batching, so few append kills land inside a transaction (0–25 per 200). The dense variant (5 ms debounce, 20 ms cap) is extra evidence beside the plan's rows, not a replacement. The compaction rows put every kill inside or right after a transaction, and those are what exercise rollback and WAL recovery.
- On `macos-26-intel` and `windows-11-arm` the compaction takes longer than 20 ms, so every compaction kill lands before COMMIT (200–0). The gate runners show both outcomes.
- The kills after `READY` that land before the first ack exercise reopen-after-startup-kill.

### Commit times, 4 KB, one row per transaction (context only on hosted VMs)

| Machine | `synchronous=FULL`, worker: p50 / p95 / max (ms) | same, main thread | `synchronous=OFF`, worker: p50 |
|---|---|---|---|
| **Owner Mac, M5 Max** (`fullfsync` on, 2,000 commits) | **4.02 / 6.16 / 16.87** | 4.14 / 6.80 / 41.02 | 0.03 |
| Owner Mac, `fullfsync=0` (control) | 0.13 / 0.63 / 19.06 | — | — |
| `macos-26` (VM, `fullfsync` on) | 1.24 / 6.04 / 89.95 | 1.56 / 12.19 / 50.60 | 0.04 |
| `macos-26-intel` (VM) | 3.26 / 4.80 / 41.93 | 3.00 / 4.39 / 40.93 | 0.07 |
| `windows-latest` (VM) | 0.34 / 0.48 / 3.98 | 0.35 / 0.55 / 8.95 | 0.04 |
| `windows-11-arm` (VM) | 3.97 / 5.92 / 65.66 | 3.96 / 5.77 / 52.83 | 0.06 |
| `ubuntu-24.04` (VM) | 0.14 / 0.54 / 2.77 | 0.16 / 0.55 / 6.16 | 0.02 |
| `ubuntu-24.04-arm` (VM) | 0.14 / 0.61 / 2.59 | 0.15 / 0.75 / 3.21 | 0.03 |

The "up to 26 ms" an fsync can take (plan) is close to the owner Mac's max (16.9 ms in the worker, 41 ms on main) and to the hosted Mac VMs' tail. Windows Defender on the hosted runners (`Get-MpComputerStatus`): `windows-latest` `RealTimeProtectionEnabled` **False**, `windows-11-arm` **True**, which likely explains its 4 ms p50 against 0.34 ms. The Windows verdict machine (a laptop with Defender on) is owner hardware and belongs to S5.

## Evidence

- Run [43909325904](https://github.com/docs-plus/editor/actions/runs/43909325904): per-job step summaries, and artifacts `s2-<runner>-<target>` (pragma and round-trip JSON, commit times, harness summary JSON and per-kill logs), kept 90 days.
- [`spike-evidence/s2/`](spike-evidence/s2/): the owner-Mac commit times and harness summaries (the first of the two 200-kill append runs, 182 after first ack and 2 inside a batch, is not in the folder; its summary line matched the second's verdict).

## Findings beyond the rows

- **`__dirname` in Bun bundles.** `bun init` writes `"type": "module"`, and `Bun.build` then inlines the *source* directory for `__dirname` in the CJS output. Locate sibling bundles with `app.getAppPath()` (the directory of `main.cjs`), not `__dirname`. The S6 smoke does the same; arch §3.1 step 2 now says so.
- **An uncaught exception in Electron main opens a modal dialog**, which hangs CI. Spike and smoke code exit with `process.exit(1)` after printing the failure.
- **Electron 45 has no postinstall.** The binary downloads on the first `require("electron")` (or `bun install-electron`); `bun pm trust electron` is a no-op. CI triggers the download before the Node stub step.
- **Worker `writeSync(1, …)`** puts protocol lines on stdout immediately on all three OSes, including Windows, so the harness reads acks without main-thread relay delay.

## Decision

- **D-A6 pragmas: confirmed.** WAL, `synchronous=FULL`, `fullfsync=1` and `checkpoint_fullfsync=1` on macOS read back as set; F_FULLFSYNC is real on Apple silicon (4.0 ms p50 against 0.13 ms without it).
- **Crash atomicity: passes with `node:sqlite`.** No Tauri revisit from S2; `better-sqlite3` is not needed.
- **D-A1: unchanged here.** The worker stays as specified until S5's commit-arm rule decides (four ratios on the owner's Mac and a Windows laptop with Defender on). Hosted and owner-Mac commit tables are not D-A1 evidence. If the Windows verdict machine is missing, the plan's fallback applies: D-A1 is decided on the Mac alone, keeping the worker.
- **P2.6 soak T1–T8:** reuse `kill-harness.ts`'s shape (READY-anchored kills, deterministic reference, pid-gone check, verify in a fresh process) and add the dense variant to raise mid-transaction coverage.

Spec lines this changes: arch D-A6 (evidence link), arch §3.1 step 2 (the `app.getAppPath()` note), arch D-A1 reason column ("S2 shows…", decision still S5's). See the amendments in this PR.

## How to rerun

```bash
git switch spike/s2-storage && cd spikes/s2-storage && bun install && bun run build
bun electron dist/main.cjs --mode=commit-loop --thread=worker --count=2000 --db "$(mktemp -d)/c.sqlite"
bun electron dist/main.cjs --mode=commit-loop --thread=worker --count=2000 --fullfsync=0 --db "$(mktemp -d)/c.sqlite"
bun kill-harness.ts --kills 200 --target append   # then --target compaction, --synchronous=OFF, --dense
```

## Issues filed

None. No row failed and every non-blocking row has its owner (S5 for typing during commits).
