# Desktop plan: Phase 2 status and coordination decisions (2026-11-22)

A snapshot for anyone joining the desktop and local-first work. The plan itself is
[`2026-11-15-desktop-local-first-design.md`](../specs/2026-11-15-desktop-local-first-design.md) (v8);
its §8.4 tables define every PR row named here. This file records where each row
stands and the decisions made while executing it. It does not change the plan.

## Where things stand

Production auto-deploys `main` after green CI (`AUTO_DEPLOY=on` since 2026-11-17).
On 2026-11-22 production ran `ed2a7cd`.

| Row | What | State |
|---|---|---|
| Phase 1 | Web fixes P1.1, P1.1b, P1.2, W1, A0, F1–F3, F5; spikes S1–S6 | Merged |
| P2.1 | `DocSession` and `DocStore` ports (#119), `local-session`, the batcher, `MemoryDocStore` and the framework-free contract suite (#121) | Merged |
| P2.1c | `useYjsDocument` reads `DocSession` from context (#133) | Merging in batch #139 |
| P2.2 | Editor accepts no provider, stable Awareness, `WriteGate`, the decoration host, the editor-chunk fence (#123) | Merged |
| P2.2 follow-up | Status chip injected from the composition root (#134) | In review |
| P2.3 | Tab list behind the `DocumentIndex` port (#122) | Merged |
| P2.4a | Desktop static export, `bun run build:desktop` (#127) | Merged |
| P2.4b | Dev bridge, `DesktopRoot`, the `local` Playwright project, the desktop route allowlist (#136) | In review |
| P2.5 | Electron shell (#135) | Fixing 11 security-review findings |
| P2.6 | SQLite storage worker (#125); daily copy in a terminable thread (#128) | Merged |
| P2.6 fix | Windows: close the copy's files before deleting the partial (#140) | In CI |
| P2.6b, P2.6c | Desktop asset storage, inline-image migration | After A1 and P2.5 |
| P2.7a | Files sidebar, Quick Open, Move to… in `components/library/` (#132) | Merging in batch #139 |
| P2.7b | List views, sort, filters, tags | In progress |
| P2.8a | Headless schema module, Markdown export, filename cleaning | In progress |
| P2.8b | Import, open a backup, Show in Finder | After P2.5 and P2.8a |
| P2.9c-1 | Page engine (`lib/prefs/`), no on-screen controls | In progress |
| P2.9c-2, P2.9a, P2.9b | Page UI, window chrome, backups | After P2.9c-1 and P2.5 |
| P2.11 | Find | In progress (workflow) |
| P2.12 | Part 1 (#156): block move and duplicate, the Markdown paste rule, print stylesheet, all at 0 B of editor chunk. Open: the paste hook (needs a ledger line, so a budget review), word count (E3), the menu surfaces | Part 1 in review; row open |
| A1 | Shared asset core (image store §9), on the §6.2 fallback until U1 | In progress |
| W2 | Web library storage on IndexedDB, behind `NEXT_PUBLIC_LIBRARY=0` | In progress (workflow) |
| L0 | Translation-ready foundation | In progress (workflow) |
| P4.1, P4.2a–d | Share server, behind `HOCUS_SHARES=off` | In progress (workflow) |
| P4.9 | Comments core | In progress (workflow) |
| M20 | Phone keyboard inset | In progress (workflow) |
| Q1, Q5, Q7 | Test fixtures, nightly streak | In progress (workflow) |
| LK1 | Document links core | In progress |
| Bubble redesign | P0 merged (#130); P1–P4 in progress, one batch with a single owner design review | In progress |
| CI | No cancels on `main`, merge queue, e2e shards, path gating; a Bun-focused speed-up plan | In progress |
| Ops | Retention purge on (#138), after four dry runs (2026-11-19 to 2026-11-22) | Merging in batch #139 |

## Decisions made while executing

Each was made by the coordinator under the owner's delegation, unless marked
as the owner's own.

- **D-A1 stays "keep the storage worker"**, provisional until the owner's M1
  and Windows typing runs (#107, #108).
- **Daily copy (P2.6 decision 5): a batched table copy in a terminable
  `worker_thread`,** not `VACUUM INTO`. `VACUUM INTO` can't be interrupted, and
  it held a Windows quit for about 9 s. The copy runs inside one read
  transaction, keeps the schema verbatim, and runs `integrity_check` before an
  atomic rename. A quit deletes the partial file. The upgrade path, once P2.5
  exists, is `VACUUM INTO` in an Electron `utilityProcess`, recorded in the
  architecture spec.
- **Editor-chunk ledger.** P2.2 is recorded at +294 B and P2.1c at +275 B
  (details spec §1 rule 5, citing risk K14). After them, only about 6 B of
  slack remains beyond the unspent ledger lines. So any PR without a ledger
  line must add **0 B** to the editor chunk group. This covers A1 and the bubble
  phases P1–P4. Spending more needs the owner's ledger amendment.
- **Bubble redesign:**
  - The owner approved the design "as recommended" (#124).
  - Turn into → Text inside a list or quote unwraps it.
  - P3.2 (Page width ▸) is dropped; P2.9c-2 owns all page-width UI.
  - P5 waits on P4.9.
  - Merge order: P3.1, P2, P4, P1.
- **P2.9c-1 ships with no on-screen controls.** Existing visitors see the
  `classic` state, pixel-identical to `main`. P2.9c-2 adds the Page popover.
- **The dev bridge is a stand-in.** The `local` project proves the renderer
  over `MemoryDocLibrary`, not the real IPC path. The differences are listed
  in architecture §11.
- **Land dark.** Server and library features (P4.x, W2, later S-A1) ship
  behind flags that default to off, with a test pinning each default, because
  every merge deploys.
- **Retention purge on** (the owner's decision, #138). Every run backs up
  before deleting.

## How work merges

- Reviewed PRs merge through `integrate/…` branches, so CI runs once.
  GitHub then marks each included PR merged.
- `main`'s CI used to cancel an in-progress run on a newer push, so merges
  waited for each `main` run to finish and deploy. #143 stops that: started
  `main` runs always finish. Once the owner turns on the merge queue, PRs go
  through the queue instead of hand-built batches.
- Every non-trivial PR gets an independent staff review: security for
  transport, Electron and the server; ProseMirror and Yjs for the editor.
  Visible UI also needs the owner's design review with screenshots.

## Waiting on the owner

- Code signing enrolment (D-U-N-S, Apple Developer, Windows signing).
- The trademark search (D33).
- `PRIVACY_CONTACT`.
- DNS for the separate web library origin (D11).
- Turning on the merge queue once the CI PR lands.
- The M1 and Windows typing runs and the IME checks (#107–#109).
- The real-device phone checks (M18).
- The bubble P1–P4 design review (about 45 minutes), with two decisions:
  the page-width entry's wording, and whether OB2's unspent 10 B ledger line
  moves to the bubble.

## Estimates (head-of-engineering review, 2026-11-22)

| Milestone | Estimate | What decides it |
|---|---|---|
| Gate 2: unsigned internal builds | About 2027-01-11 | Four preference PRs in a row, each with a design review |
| Gate 3: signed builds for 10 testers | About 2027-02-22 | Signing enrolment and the trademark answer |
| v1 | About early May 2027; stable about July | About 220 owner-hours at about 10 a week |
