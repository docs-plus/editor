---
date: 2026-03-18
topic: demo-abuse-security-strategy
---

# Demo Abuse + OWASP Security Strategy

## What We're Building

We are defining operating guardrails for TinyDocy as a public demo app so anonymous users can still collaborate, while abuse (tab/document floods and oversized content) cannot grow SQLite indefinitely or degrade availability.

The selected direction is a balanced, anonymous-write model with hard server guardrails. The objective is to keep the "instant demo" experience intact while adding enough limits, throttling, and cleanup to be resilient against common abuse patterns and aligned with OWASP engineering expectations for a public-facing app.

## Why This Approach

We considered three options: guardrails-first anonymous access, anonymous access with bot-gating, and full authentication for write actions.

Guardrails-first was chosen because it gives the highest risk reduction per implementation effort and preserves current product behavior. Full auth is stronger but adds product friction and complexity not required for this demo phase. Bot-gating remains a fallback escalation path if anonymous abuse continues after guardrails are deployed.

## Architecture Reality (Next.js + Hocuspocus CLI + SQLite)

- Next.js API routes can enforce HTTP-side controls (delete/create helper endpoints, headers, structured logs, IP-based throttles).
- Hocuspocus is currently running via CLI, so websocket auth/rate-limit hooks are limited until we move to a small custom `@hocuspocus/server` bootstrap.
- SQLite is shared by Next.js and Hocuspocus; all growth controls must account for lock contention and bounded file growth (document cap, size cap, retention purge).
- Because doc creation is websocket-driven, "client-only tab limits" are insufficient; server-enforced limits must exist at the websocket persistence boundary.

## Key Decisions

- **Access model:** Keep anonymous write access for now; no mandatory login for create/edit.
- **Rate limiting:** Enforce server-side limits on mutating HTTP routes first, then websocket/doc creation events after Hocuspocus server bootstrap replaces CLI-only mode.
- **Capacity profile:** Target medium scale (~100 concurrent users, ~2,000 total documents).
- **Tab guardrail:** Cap max tabs per client session (soft client cap + hard server-side doc-creation controls).
- **Document growth control:** Enforce document count ceiling and per-document size ceiling to prevent unbounded SQLite growth.
- **Retention:** Auto-delete documents after 30 days of inactivity.
- **Security baseline:** Add OWASP-aligned hardening (security headers, strict input validation, safe defaults, structured audit logs).
- **Limit-hit behavior:** Return explicit throttling/quota responses (429/403), surface clear UX messaging, and fail closed for creation when caps are reached.

## Concrete Policy Baseline (Initial)

- `MAX_TABS_PER_CLIENT`: 50
- `MAX_TOTAL_DOCUMENTS`: 2,000 (new doc creation blocked above threshold)
- `MAX_DOC_SIZE`: 1 MB persisted payload (reject writes above threshold)
- `HTTP_MUTATION_RATE_LIMIT`: 30 requests/min/IP burst + lower sustained window
- `WS_CONNECTION_LIMIT`: 10 concurrent connections/IP
- `DOC_CREATION_RATE_LIMIT`: 10 creations/hour/IP
- `RETENTION_WINDOW`: 30 days inactivity-based purge

## OWASP-Focused Controls for This Repo

- **A01 Broken Access Control:** validate document IDs and enforce creation limits server-side, not only in client state.
- **A03 Injection:** keep prepared SQLite statements everywhere; reject invalid identifier formats early.
- **A04 Insecure Design:** formalize abuse quotas and fail-closed behavior when limits hit.
- **A05 Security Misconfiguration:** add security headers (CSP, X-Frame-Options/`frame-ancestors`, nosniff, referrer policy).
- **A09 Security Logging/Monitoring Failures:** add structured logs and counters for throttles, rejections, and cleanup events.
- **A10 SSRF / unsafe URL handling:** keep strict URI allowlist for links/media and block dangerous schemes.

## Monitoring Signals

- Requests throttled per IP (HTTP + WS)
- New document creation rate (per minute/hour)
- Total document count and growth slope
- SQLite file size and daily delta
- Cleanup job deletions and failures

## Open Questions

- None.

## Resolved Questions

- **Posture:** Balanced (throttle bursts, graceful errors)
- **Capacity target:** Medium (~100 concurrent users, ~2,000 docs)
- **Write model:** Anonymous write
- **Retention:** 30-day inactivity cleanup
- **Chosen approach:** A) Guardrails-First

## Next Steps

-> Implementation plan: `docs/plans/2026-03-18-feat-demo-abuse-owasp-guardrails-plan.md`
