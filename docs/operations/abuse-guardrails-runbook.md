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
  document unloads once its last client leaves). Enforced on incoming updates too:
  a client whose update would push a document past its cap is disconnected
  (`ws_update_too_large`) before the document grows in memory.
- `MAX_PLAYGROUND_DOC_SIZE_BYTES=4194304`, `MAX_TABS_DOC_SIZE_BYTES=262144`: caps for
  the shared `playground` and `global-tabs` documents (no shared document is unlimited)
- `HOCUS_MAX_PAYLOAD_BYTES=2097152` (larger frames close with 1009),
  `HOCUS_BACKPRESSURE_LIMIT_BYTES=8388608`, `MAX_AWARENESS_STATE_BYTES=4096`
- `WS_SOCKETS_PER_IP` (default 3x `WS_CONNECTION_LIMIT`), `MAX_WS_SOCKETS=5000`,
  `WS_UPGRADE_RATE_LIMIT=60` per minute: admission at the WebSocket upgrade, before
  any document auth; rejected upgrades get HTTP 429/503
- `HOCUS_AUTH_TIMEOUT_MS=10000`: sockets that send nothing are closed (4408)
- `HOCUS_ALLOWED_ORIGINS` (comma list; `ecosystem.config.cjs` sets
  `https://tiny.docs.plus`): browser origins allowed to open sockets. Clients without
  an `Origin` header (load tests, scripts) are allowed.
- `HOCUS_HOST=0.0.0.0`: bind address. Set it to the address the reverse proxy reaches
  (for example the Docker bridge IP) so the firewall is not the only boundary.
- `RATE_LIMIT_MAX_KEYS=50000`: per-limiter key cap; new keys fail closed when full.
  IPv6 clients are keyed by their /64.
- `HOCUS_ALLOW_ISOLATED_TABS_DOCS=1`: **dev and tests only** (`make dev`, Playwright).
  Allows per-test `global-tabs-<id>` documents. The server refuses to start with it in
  production.
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
- **P2**: sustained throttle spike (`429`, `ws_guardrail_rejected`,
  `ws_upgrade_rejected` or `ws_throttle_ban`) for 5+ minutes, or any
  `tabs_doc_repaired`
- **P3**: retention purge failure

## Detection and Triage

Search logs for these JSON event names:

- `documents_delete_throttled`
- `documents_delete_invalid_id`
- `documents_delete_failed`
- `retention_purge_completed`
- `retention_purge_completed_retry`
- `document_store_rejected` (document over its size cap; not persisted)
- `document_deleted` (successful DELETE; the name is tombstoned so an open session
  cannot write it back)
- `documents_delete_system_rejected` (attempt to delete `playground` or `global-tabs`)
- `ws_guardrail_rejected` with `reason`: `ws_connection_limit_exceeded`,
  `invalid_document_name`, `document_deleted`, `doc_creation_rate_limit_exceeded`,
  `max_total_documents_exceeded`
- `ws_upgrade_rejected` with `reason`: `ws_origin_rejected`, `ws_sockets_per_ip`,
  `ws_server_full`, `ws_upgrade_rate`
- `ws_throttle_ban` (Throttle banned an IP), `ws_auth_timeout`
- `ws_update_too_large`, `ws_awareness_too_large`
- `tabs_doc_repaired` (malformed entries removed from a shared tab list; repeated
  events point to a client writing bad data)

Hocuspocus Logger output is one JSON line per message (`{"type":"hocus",...}`), so
client-chosen document names cannot forge log lines.

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

## Scheduled Jobs

- Retention: run `bun run scripts/purge-retention.ts` daily (cron or a systemd timer).
  It deletes documents idle for `RETENTION_DAYS` and tombstones older than that. Nothing
  in the repository schedules it.
- Rotate PM2 logs (`pm2-logrotate`, 14 days): abuse events contain IP addresses.

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
