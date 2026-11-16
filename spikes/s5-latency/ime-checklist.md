# Spike S5 IME checklist (owner, real hardware)

Status: **pending owner hardware.** No agent can drive a real IME; a person
runs this on each OS and ticks it. Record a short screen recording (under
10 s) or a screenshot of the candidate window per OS.

Build: `bun spikes/s1-shell/build-export.ts`, `cd spikes/s5-latency && bun run build`,
then start Hocus (`bun spikes/s5-latency/run.ts` starts it with the app) and
launch `spikes/s5-latency/node_modules/electron/dist/<Electron binary> spikes/s5-latency/dist/main.cjs`.

Engines:
- macOS: Japanese – Romaji input
- Windows 11: Microsoft IME, Japanese
- Ubuntu 24.04 GNOME Wayland: IBus with Mozc, native Wayland (Electron's
  default `--ozone-platform=auto`). If it fails, repeat with
  `--ozone-platform=x11`; a pass there is recorded as "falls back to
  XWayland", plus a fractional-scaling screenshot.

In each block — title, paragraph, heading, list item, table cell, code
block — compose `nihongo`, convert, and commit 日本語:

| Check | macOS | Windows | GNOME Wayland |
|---|---|---|---|
| No duplicated or lost characters | ☐ | ☐ | ☐ |
| The candidate window sits at the caret | ☐ | ☐ | ☐ |
| Enter during composition commits and doesn't split the block | ☐ | ☐ | ☐ |
| One undo removes the committed word | ☐ | ☐ | ☐ |
| "/" typed inside a composition doesn't open the slash menu | ☐ | ☐ | ☐ |
| A collaborator's edit during a composition doesn't break it (second window on the same doc) | ☐ | ☐ | ☐ |

Owner latency verdict runs (same harness, quiet machine):
- the owner's M1 Mac: `CHROME_PATH=<CfT 156> S5_MACHINE=owner-m1 bun spikes/s5-latency/run.ts`
- a Windows laptop with Defender on: record `Get-MpComputerStatus` first, then
  `S5_MACHINE=owner-windows-defender bun spikes/s5-latency/run.ts`
