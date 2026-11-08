# Abuse Guardrails Runbook

## Scope

This runbook covers operational handling for TinyDocy demo abuse guardrails:

- HTTP delete throttling
- WebSocket connection/document guardrails
- Retention purge safety

## Runtime

- Hocuspocus 4 always runs via `bun run hocus`: `Bun.serve` + `Hocuspocus.handleConnection`,
  `bun:sqlite` persistence (`lib/hocus-persistence.ts`), guardrail hooks, optional extensions.
- `SIGINT`/`SIGTERM` flush pending document stores before exit (bounded at 10s).

## Key Configuration

- `NEXT_PUBLIC_MAX_TABS_PER_CLIENT=50`
- `HTTP_MUTATION_RATE_LIMIT=30`
- `WS_CONNECTION_LIMIT=10`
- `DOC_CREATION_RATE_LIMIT=10`
- `MAX_TOTAL_DOCUMENTS=2000`
- `MAX_DOC_SIZE_BYTES=1048576` (encoded Yjs state; oversized stores are skipped and the
  document unloads once its last client leaves)
- `RETENTION_DAYS=30`
- `TRUSTED_PROXY=0` (`1` only when a reverse proxy fronts every request;
  `ecosystem.config.cjs` sets `1`; see Client IP Extraction Policy)
- `HOCUS_LOGGER=0` to disable Hocuspocus Logger extension
- `HOCUS_THROTTLE=0` to disable Hocuspocus Throttle extension
- `HOCUS_THROTTLE_MAX_ATTEMPTS`, `HOCUS_THROTTLE_WINDOW_SECONDS`, `HOCUS_THROTTLE_BAN_MINUTES`
- `HOCUS_REDIS=1` to enable Hocuspocus Redis pub/sub extension (opt-in)
- `HOCUS_REDIS_HOST` (default: `127.0.0.1`)
- `HOCUS_REDIS_PORT` (default: `6380`, non-default to avoid host Redis conflicts)

Redis deployment notes:

- `ecosystem.config.cjs` starts Redis via `editor-redis`, which requires a host-installed `redis-server` binary.
- Redis extension supports cross-instance signaling, but SQLite remains the persistence layer.
- Keep Hocuspocus to one instance per SQLite file unless persistence is moved to shared storage.

## Severity Levels

- **P1**: total document cap reached, users cannot create new docs
- **P2**: sustained throttle spike (`429` or WS guardrail rejects) for 5+ minutes
- **P3**: retention purge failure

## Detection and Triage

Search logs for these JSON event names:

- `documents_delete_throttled`
- `documents_delete_invalid_id`
- `documents_delete_failed`
- `retention_purge_completed`
- `retention_purge_completed_retry`
- `document_store_rejected` (document over `MAX_DOC_SIZE_BYTES`; not persisted)

Expected healthy signals:

- Occasional throttles, low invalid-id noise
- Retention purge succeeds with bounded deletions

Failure signals:

- Sharp sustained increase in `documents_delete_throttled`
- Frequent `documents_delete_failed`
- Repeated missing/failed retention events
- `documents_delete_throttled` with `"ip":"unknown"` in production: client IPs
  are not being resolved, so everyone shares one bucket. Check `TRUSTED_PROXY`
  and the proxy's forwarding headers.

## Immediate Actions

1. Reduce blast radius by tightening/de-tuning env thresholds as needed.
2. If WS runtime instability appears, restart the Hocus process; tune or disable `HOCUS_THROTTLE` / guardrail envs if false positives dominate.
3. If retention fails repeatedly, run purge manually after service stabilization.

## Client IP Extraction Policy

Per-IP guardrails (`WS_CONNECTION_LIMIT`, `DOC_CREATION_RATE_LIMIT`,
`HTTP_MUTATION_RATE_LIMIT`, Hocuspocus Throttle) key on the client IP from
`lib/security/client-ip.ts`.

- Use `X-Forwarded-For`/`X-Real-IP` only when `TRUSTED_PROXY=1`.
- `TRUSTED_PROXY=0` (default): both headers are client-controlled and ignored.
  - WebSocket: the TCP peer address.
  - HTTP (`DELETE /api/documents/[id]`): Next.js route handlers have no socket
    address, so all requests share the `unknown` key. The limit becomes global
    instead of bypassable by rotating headers.
- `TRUSTED_PROXY=1`: the rightmost `X-Forwarded-For` entry (the address the
  proxy appended; entries to its left are client-supplied), else `X-Real-IP`,
  else (WebSocket only) the peer address.
  - Assumes one proxy hop that appends to `X-Forwarded-For` (Traefik, Caddy,
    HAProxy, nginx `$proxy_add_x_forwarded_for`). Behind a CDN plus a proxy the
    rightmost entry is the CDN edge, so clients share a key per edge.
  - The app ports (`3847`, `3848` under PM2) must be reachable only from the
    proxy. A client that reaches them directly can forge the headers.
- The Hocuspocus server resolves the IP once at the WebSocket upgrade and
  rewrites the request so `X-Real-IP` holds it and `X-Forwarded-For` is
  removed. Guardrail hooks and Throttle all read that value.
- Values that are not a bare IP (for example `203.0.113.5:4711`) become
  `unknown`; IPv4-mapped IPv6 (`::ffff:203.0.113.5`) is unwrapped.
- In non-dev environments (`NODE_ENV` other than `development`), private/reserved
  addresses are treated as unknown client identity. Behind a proxy with
  `TRUSTED_PROXY=0`, every client therefore shares `unknown`.
