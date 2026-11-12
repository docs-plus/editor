# Schema Rollout Runbook

How TinyDocy ships new document marks and nodes without old browser bundles
deleting content. Design background: `docs/superpowers/specs/2026-11-12-smart-toolbar-design.md`
section 3.1.

An old bundle that meets a mark it does not know makes y-prosemirror delete the
whole block and upload the deletion. Four guards stop that. Release N (this
change) ships all four; the minimum client schema stays log-only until a later
release raises it.

## What the guards are

| Guard | What it does | Where to see it |
|---|---|---|
| Version gate | The client sends `schema=2` and `build=<id>` on the shared socket URL (`lib/schema-version.ts`). Hocus counts them and, when `HOCUS_MIN_CLIENT_SCHEMA` is above 0, refuses older bundles with `client_outdated`. | `client_schema` log line, once a minute |
| Offline namespace | Device copies live under `1:${host}~s2:${name}`. Pre-N bundles never read that key, so they cannot save a damaged copy over a new one. Legacy copies are merged in, then deleted inside one IndexedDB transaction. | none (client only) |
| Freeze and repair | A document with unknown node or mark names freezes read-only with the update banner, by design. Any misfit made only of known names is fitted to the schema in place: an emptied fragment is reseeded, a missing title inserted, elements whose content does not fit are removed (as earlier releases did) and stray inline nodes such as a top-level hard break are wrapped in a paragraph. | `schema_repair_failed` analytics event when a repair fails |
| Ingress allowlist | Hocus refuses any update that names a node or mark outside `lib/schema-names.ts`, or puts content other than an element directly in the editor fragment (logged as `#text`), and closes that document's connection with `4422` `schema_rejected`; the shared socket and its other documents stay open. Malformed sync frames are refused the same way. | `ws_unknown_schema_name` abuse event |

Details worth knowing:

- **Gate.** Never set `HOCUS_MIN_CLIENT_SCHEMA` above the highest schema any
  shipped bundle sends (currently 2), or release N clients are refused too.
  At `HOCUS_MIN_CLIENT_SCHEMA=0` (the default) nothing is refused.
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
- Staging drill: env set to 0, effective minimum still 2 (once PR C ships the floor).
- CHANGELOG Deploy note: Hocus restart first, then Next, at low traffic.

## Release order

Release N (the change that introduces these guards) goes first with the gate
log-only. Raising the minimum follows the four steps from the spec. PM2 process
names are `editor-hocus` and `editor-next`.

1. **Deploy release N** — client + server; gate log-only; server ingress allowlist is the current schema plus legacy `link`/`code`. `textColor` and `fontSize` are **not** allowed yet: they ship with PR C's server half in step 3. Allowed earlier, anyone could write `textColor` and freeze any document for every N client. (N clients that meet them freeze read-only by design, never delete.)
2. **Wait** for the N+1 ship gates (adoption above).
3. **Server-only step: deploy PR C's server half and restart Hocus *before* Next.** It adds `textColor` and `fontSize` to the ingress allowlist. PR C sets `SCHEMA_FLOOR = 2` in code, so the gate turns on with the Hocus restart regardless of env. (Until PR C ships, setting `HOCUS_MIN_CLIENT_SCHEMA=2` is the manual equivalent.) The owner runs it: `bunx pm2@6.0.14 restart editor-hocus --update-env`, confirm refusals in the log (`refused` above 0 in `client_schema`), then `bunx pm2@6.0.14 restart editor-next --update-env`. Verify the build step does not change the client bundle served by the still-running Next process before its restart; if it does, build into a separate directory.
4. **Restart Next** to serve the new client with the new marks.

Never serve the new client before step 3 completes. Deploy at low traffic.

Release N itself: restart `editor-hocus` first, then rebuild and restart
`editor-next`, with `HOCUS_MIN_CLIENT_SCHEMA` unset or `0`.

## Rollback

- Reverting the **client** is safe, down to release N.
- **Never lower the floor.** Never set `HOCUS_MIN_CLIENT_SCHEMA` below a value
  it has already had in production: bundles that were refused would be
  admitted again and could damage documents. A later release makes this
  structural with `SCHEMA_FLOOR = 2` in code; until then it is a rule.
- **Never roll back below release N.** Pre-N bundles do not know the guards.
  Offline copies are the practical reason: while pre-N and N bundles coexist on
  one device, storage can hold up to 30 legacy plus 30 `~s2` copies, and after N
  merges a legacy copy, a pre-N bundle cannot see that merged copy, so its
  unsynced edits stay hidden until the device runs N again (within the 14-day
  copy expiry).

## Allowlist rule

Every new mark or node name ships in `lib/schema-names.ts` in a Hocus restart
that **precedes** any client that writes it. The allowlist is the current
schema plus legacy `link`/`code`; `textColor` and `fontSize` join it with PR
C's server half (release order step 3), never earlier.
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

## Scripts and load tests

Anything that opens a collaboration socket must send `?schema=2` once the
minimum is above 0, or it is refused. The load harness
(`tests/load/yjs-load-harness.ts`) already does. Tests that spawn Hocus use
`spawnHocus()` from `tests/helpers/spawn-hocus.ts`; see
[tests/TESTING.md](../../tests/TESTING.md).
