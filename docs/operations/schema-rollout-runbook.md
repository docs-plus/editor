# Schema Rollout Runbook

How TinyDocy ships new document marks and nodes without old browser bundles
deleting content. Design background: `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md`
section 3.1.

An old bundle that meets a mark it does not know makes y-prosemirror delete the
whole block and upload the deletion. Four guards stop that. Release N ships
all four with the gate log-only; release N+1 (smart toolbar PR C) sets the
built-in floor `SCHEMA_FLOOR = 2`, so from then on the gate always refuses
bundles below schema 2. A server-side root sweep also keeps every document
mountable when content slips past the ingress check.

## What the guards are

| Guard | What it does | Where to see it |
|---|---|---|
| Version gate | The client sends `schema=2` and `build=<id>` on the shared socket URL (`lib/schema-version.ts`). Hocus counts them and refuses bundles below `max(HOCUS_MIN_CLIENT_SCHEMA, SCHEMA_FLOOR)` with `client_outdated` (`SCHEMA_FLOOR = 2` from release N+1; release N has no floor and refuses nothing at env 0). | `client_schema` log line, once a minute |
| Offline namespace | Device copies live under `1:${host}~s2:${name}`. Pre-N bundles never read that key, so they cannot save a damaged copy over a new one. Legacy copies are merged in, then deleted inside one IndexedDB transaction. | none (client only) |
| Freeze and repair | A document with unknown node or mark names freezes read-only with the update banner, by design. Any misfit made only of known names is fitted to the schema in place: an emptied fragment is reseeded, a missing title inserted, elements whose content does not fit are removed (as earlier releases did) and stray inline nodes such as a top-level hard break are wrapped in a paragraph. | `schema_repair_failed` analytics event when a repair fails |
| Ingress allowlist | Hocus refuses any update that names a node or mark outside `lib/schema-names.ts`, or puts content other than an element directly in the editor fragment (logged as `#text`), and closes that document's connection with `4422` `schema_rejected`; the shared socket and its other documents stay open. Malformed sync frames are refused the same way. | `ws_unknown_schema_name` abuse event |
| Root sweep | After every change to the top level of a document's editor fragment, and once when Hocus loads a document, Hocus deletes anything there that is not an element (`lib/security/editor-root-sweep.ts`). y-tiptap throws on such content before the client repair can run, so without the sweep no client could open the document. | `editor_root_swept` abuse event |

Details worth knowing:

- **Gate.** The effective minimum is `max(HOCUS_MIN_CLIENT_SCHEMA,
  SCHEMA_FLOOR)` (`effectiveMinClientSchema` in
  `lib/security/client-schema-gate.ts`); the startup line prints it as
  `[hocus] client schema gate: min=2 (floor 2, env 0)`. The env can only raise
  it. Never set `HOCUS_MIN_CLIENT_SCHEMA` above the highest schema any
  shipped bundle sends (currently 2), or current clients are refused too.
  In release N (no floor), `HOCUS_MIN_CLIENT_SCHEMA=0` refuses nothing.
  At 1 or more, a socket is refused unless `schema` is a plain decimal integer
  at or above the minimum; a missing value counts as 0. `global-tabs` and every
  `global-tabs-*` document are exempt so outdated clients can still list tabs
  and show the banner. `playground` is gated. Order in `onConnect`: tombstone
  check, gate, then the usual connection checks. The gate never calls
  `reject()`, so refusals do not feed the abuse alerts, and raw `schema` values
  are never logged. Neither `client_outdated` nor `schema_rejected` makes the
  client reconnect.
- **Ingress.** Frames are decoded with lib0 the way Hocuspocus does (message
  types 0 and 4). A frame that cannot be decoded is also refused, logged with
  `names: []`. Decoding every frame also closed an older size-cap bypass that
  used SyncReply frames and padded varints.
- **Root sweep.** Ingress places top-level content against the server's copy
  of the document. Content whose position the server does not have yet is let
  through, because a client resuming from its device copy types before its
  sync completes; Yjs holds it pending until a later update supplies the
  position. A client can use that to land text directly in the fragment
  (send the text first, then the block it follows). The sweep is a shallow
  Yjs observer on the `default` fragment, installed by `DocumentGuard` in
  `afterLoadDocument` (tab lists are skipped). It runs synchronously inside the
  transaction that released the content, whatever its source (a connection,
  Redis, or a pending update), so its deletion is queued in the same
  event-loop turn as the update that released the content, and Hocuspocus
  merges both into one broadcast: connected clients never see the stray
  content. That holds only because Hocus turns off Hocuspocus's early flush
  (`BROADCAST_FLUSH_OPTIONS`: `flushDelay: 0`, `flushMaxBytes: Infinity`).
  With the 1 MiB default, a releasing update that filled the queue went out
  alone; open editors then failed on it, and a keystroke before the deletion
  arrived could rewrite the document from a stale view and lose content. Do
  not set a finite `flushMaxBytes` or `flushDelay: false`. The queue still
  empties at the end of every turn and holds only updates that are in memory
  anyway, so this adds no latency. Typing inside a block never triggers the sweep;
  adding or removing a block costs one walk of the top level. A document
  stored with such content before this release is cleaned when it next loads,
  before any client syncs.
- **Highlights.** Highlights render from tokens but keep the attribute key
  `color`. Unknown values (old hex colours, the popover's old "Default
  background" `var(--background)`) render as plain text; the stored value is
  untouched.

## Reading adoption

Hocus prints one JSON line per minute while sockets are connecting, written to
the PM2 output log (default `~/.pm2/logs/editor-hocus-out.log`):

```json
{"type":"hocus","event":"client_schema","window_start":"2026-11-12T10:41:00.000Z","missing":3,"invalid":0,"low":12,"ok":240,"refused":0,"builds":{"a1b2c3d4e5f6":240,"missing":15}}
```

`missing`, `invalid`, `low` and `ok` are mutually exclusive buckets (`low` is a
valid number below the current client schema, 2). `refused` counts attempts the
gate refused and overlaps the others. `builds` counts the `build` values seen:
no value counts as `missing`, anything outside a strict pattern as `invalid`,
and new values past the per-window cap as `other`; a non-matching value is
never echoed.

Adoption over the last 24 hours, `ok / (missing + invalid + low + ok)`:

```sh
grep '"event":"client_schema"' ~/.pm2/logs/editor-hocus-out.log \
  | jq -s --arg since "$(date -u -d '24 hours ago' +%FT%TZ)" \
    '[.[] | select(.window_start >= $since)]
     | (map(.missing + .invalid + .low + .ok) | add // 0) as $total
     | if $total == 0 then 0 else ((map(.ok) | add // 0) / $total) end'
```

(`date -d` is GNU; on macOS use `date -u -v-24H +%FT%TZ`.) An empty window
prints `0`.

**The counts are per auth attempt, not per socket or per user.** A browser that
retries, or a refused client that is retried, adds to `low` and `refused` each
time, so while the gate is enforcing the ratio understates adoption. The N+1
gate therefore reads the ratio **while the gate is log-only**:

> Ship gate: adoption at or above 95% over a trailing 24 h, held for at least
> 48 h, read while `HOCUS_MIN_CLIENT_SCHEMA` is 0.

Adoption affects user experience only; documents are already protected by the
other guards.

The full N+1 ship gates (spec section 3.1) are:

- Adoption as above (per attempt; refused retries excluded from the reading).
- Refused-client soak: 3,000 typed characters, 0 `4205` resets, 0 `ws_throttle_ban`.
- Mixed-version nightly soak, N + N+1: 0 deleted blocks, 0 unexpected freezes.
- Hostile tests: an unknown name is refused at ingress; delete-all,
  paragraph-before-title and other known-name misfits (a top-level list item
  or hard break) are repaired instead of freezing.
- Staging drill: env set to 0, effective minimum still 2 (PR C's floor;
  `tests/unit/scripts/hocus-client-gate.test.ts` runs it against a spawned
  Hocus).
- CHANGELOG Deploy note: Hocus restart first, then Next, at low traffic.

## Release order

Release N (the change that introduces these guards) goes first with the gate
log-only. Raising the minimum follows the four steps from the spec. PM2 process
names are `editor-hocus` and `editor-next`.

1. **Deploy release N** — client + server; gate log-only; server ingress allowlist is the current schema plus legacy `link`/`code`. `textColor` and `fontSize` are **not** allowed yet: they ship with PR C's server half in step 3. Allowed earlier, anyone could write `textColor` and freeze any document for every N client. (N clients that meet them freeze read-only by design, never delete.)
2. **Wait** for the N+1 ship gates (adoption above).
3. **Server-only step (release N+1, PR C): restart Hocus *before* Next.** It adds `textColor` and `fontSize` to the ingress allowlist and sets `SCHEMA_FLOOR = 2` in code, so the gate turns on with the Hocus restart regardless of env. Pull and `bun install --frozen-lockfile` in the live checkout but **do not build**: Hocus runs from source, and the running Next keeps serving its existing `.next`. The owner runs `bunx pm2@6.0.14 restart editor-hocus --update-env` and confirms `min=2 (floor 2, env 0)` and the `client_schema` counts in the log (`refused` counts pre-N bundles; 0 is fine if none are left). The exact steps are PR C's CHANGELOG Deploy note.
4. **Build and restart Next back to back** (`bun run build`, then `bunx pm2@6.0.14 restart editor-next --update-env`) to serve the new marks. Whether an in-place build disturbs the still-running Next was not checked; pages may fail to load between the two commands.

Never serve the new client before step 3 completes. Deploy at low traffic.

Release N itself: restart `editor-hocus` first, then rebuild and restart
`editor-next`, with `HOCUS_MIN_CLIENT_SCHEMA` unset or `0`.

## Rollback

- Reverting the **client** is safe, down to release N.
- **Never lower the floor.** Never set `HOCUS_MIN_CLIENT_SCHEMA` below a value
  it has already had in production: bundles that were refused would be
  admitted again and could damage documents. From release N+1 the floor is
  structural (`SCHEMA_FLOOR = 2` in code); never lower that constant.
- **Rolling Hocus back below N+1:** roll Next back to N first and set
  `HOCUS_MIN_CLIENT_SCHEMA=2`, because release N's code has no floor and
  with the env unset readmits pre-N bundles that delete coloured blocks. N+1
  tabs still open then get `4422` on `textColor`/`fontSize` until they reload.
  Rolling only Next back to N is safe: N clients freeze on the new marks,
  never delete.
- **Never roll back below release N.** Pre-N bundles do not know the guards.
  Offline copies are the practical reason: while pre-N and N bundles coexist on
  one device, storage can hold up to 30 legacy plus 30 `~s2` copies, and after N
  merges a legacy copy, a pre-N bundle cannot see that merged copy, so its
  unsynced edits stay hidden until the device runs N again (within the 14-day
  copy expiry).

## Allowlist rule

Every new mark or node name ships in `lib/schema-names.ts` in a Hocus restart
that **precedes** any client that writes it. The allowlist is the current
schema plus legacy `link`/`code`. Worked example: `textColor` and `fontSize`
joined it with PR C's server half (release order step 3), in the same commit
as the schema snapshot, and Hocus restarts before Next serves them.
The schema snapshot test (`tests/unit/schema/schema-snapshot.test.ts`) fails
when the editor schema drifts from the committed snapshot, which is how an
unreviewed change from the daily docs.plus extension refresh is caught; update
the allowlist and the snapshot in the same change and deploy the allowlist
first.

## Banners users may report

| Banner | Meaning | What to do |
|---|---|---|
| "A newer TinyDocy is available. Reload to keep editing; your changes on this device are kept." | Either the server refused this bundle (`client_outdated`) or the document holds content this bundle does not know. The document is read-only; the device copy is kept. The Reload button saves pending copies first. | Reload. If it persists after the new build is served, check the deploy served the right bundle. |
| "This document can't be edited in this version." | A known-name misfit could not be repaired (the repair threw, or the content still did not fit). Counted by `schema_repair_failed`. | Collect the document name; copy content from the read-only view. Repeats mean a repair gap: file a bug. |
| "The server didn't accept this document's latest changes. Your changes on this device are kept." | Ingress refused an update (`4422` `schema_rejected`, `ws_unknown_schema_name`). | Check the `names` in the abuse event: an unlisted mark or node means the allowlist rule was broken. |

## Alerts

`ws_unknown_schema_name` in the abuse log is normally zero. A steady trickle
means a client is writing names the server does not allow: either a hostile
client or a release that skipped the allowlist step. Treat more than a handful
per hour, or any burst from many IPs after a deploy, as P2. See the
[abuse guardrails runbook](abuse-guardrails-runbook.md).

`editor_root_swept` is normally zero too. `phase: "load"` means a document
stored before this release held top-level content; a few right after the
deploy are expected. `phase: "update"` means a client got content past ingress
by sending it before its position; treat any as P2. Hocus logs at most one
such line per document per minute and counts the rest in a later line with
`sweeps` and no `ip`. The `ip` is the connection whose update released the
content, which an attacker can arrange to be an innocent client's; never act
on it alone.

## Scripts and load tests

Anything that opens a collaboration socket must send `?schema=2`, or it is
refused (always, from release N+1; `global-tabs*` documents are exempt). The load harness
(`tests/load/yjs-load-harness.ts`) already does. Tests that spawn Hocus use
`spawnHocus()` from `tests/helpers/spawn-hocus.ts`; see
[tests/TESTING.md](../../tests/TESTING.md).

## Text colour, size and highlight values

Release N+1 stores palette tokens: `textColor { color }`, `fontSize { size }`
(`xs sm lg xl`) and `highlight { color }`, rendered only as `data-*`
attributes styled by `extensions/text-style-marks/text-style-marks.scss`.
Unknown values from a raw client render as plain text. Highlights written by
release N as `var(--tt-color-highlight-X)` render as the same token and are
not rewritten in storage yet: the server rewrite in `lib/yjs-mark-migration.ts`
is deferred (cleanup only). It must land only after the toolbar's new colour
popover (PR D2) writes tokens: the release N popover writes and compares the
legacy form, so rewriting stored values earlier would drop its pressed state
on every reloaded document.
