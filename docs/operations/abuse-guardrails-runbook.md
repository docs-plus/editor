# Abuse Guardrails Runbook

## Scope

This runbook covers operational handling for TinyDocy demo abuse guardrails:

- HTTP delete throttling
- WebSocket connection/document guardrails
- Retention purge safety

## Runtime

- Hocuspocus always runs via `bun run hocus` (custom bootstrap + SQLite + extensions).

## Key Configuration

- `NEXT_PUBLIC_MAX_TABS_PER_CLIENT=50`
- `HTTP_MUTATION_RATE_LIMIT=30`
- `WS_CONNECTION_LIMIT=10`
- `DOC_CREATION_RATE_LIMIT=10`
- `MAX_TOTAL_DOCUMENTS=2000`
- `MAX_DOC_SIZE_BYTES=1048576`
- `RETENTION_DAYS=30`
- `TRUSTED_PROXY=0` (`1` behind trusted reverse proxy)
- `HOCUS_LOGGER=0` to disable Hocuspocus Logger extension
- `HOCUS_THROTTLE=0` to disable Hocuspocus Throttle extension
- `HOCUS_THROTTLE_MAX_ATTEMPTS`, `HOCUS_THROTTLE_WINDOW_SECONDS`, `HOCUS_THROTTLE_BAN_MINUTES`

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

Expected healthy signals:

- Occasional throttles, low invalid-id noise
- Retention purge succeeds with bounded deletions

Failure signals:

- Sharp sustained increase in `documents_delete_throttled`
- Frequent `documents_delete_failed`
- Repeated missing/failed retention events

## Immediate Actions

1. Reduce blast radius by tightening/de-tuning env thresholds as needed.
2. If WS runtime instability appears, restart the Hocus process; tune or disable `HOCUS_THROTTLE` / guardrail envs if false positives dominate.
3. If retention fails repeatedly, run purge manually after service stabilization.

## Client IP Extraction Policy

- Use `X-Forwarded-For`/`X-Real-IP` only when `TRUSTED_PROXY=1`.
- In non-dev environments, private/reserved addresses are treated as unknown client identity.
