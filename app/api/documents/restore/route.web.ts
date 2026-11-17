import { NextResponse } from "next/server";

import { MAX_TABS_PER_CLIENT } from "@/lib/constants";
import { logAbuseEvent } from "@/lib/security/abuse-log";
import { bootstrapDocumentActivityTable } from "@/lib/security/activity-store";
import { getClientIpFromHeaders } from "@/lib/security/client-ip";
import {
  closedCutoffMs,
  restoreClosedDocuments,
} from "@/lib/security/closed-documents";
import {
  isSystemDocumentId,
  isValidUserDocumentId,
} from "@/lib/security/doc-id-validator";
import { HTTP_MUTATION_RATE_LIMIT_PER_MINUTE } from "@/lib/security/guardrail-config";
import {
  rateLimitedResponse,
  readJsonBody,
  withBusyRetry,
} from "@/lib/security/http-route-guards";
import { createSlidingWindowLimiter } from "@/lib/security/rate-limit";
import { openSqlite } from "@/lib/sqlite-open";

const ROUTE = "/api/documents/restore";
const ONE_MINUTE_MS = 60_000;
const MAX_BODY_BYTES = 4096;
const restoreLimiter = createSlidingWindowLimiter({
  limit: HTTP_MUTATION_RATE_LIMIT_PER_MINUTE,
  windowMs: ONE_MINUTE_MS,
});

function isRestorableId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    isValidUserDocumentId(value) &&
    !isSystemDocumentId(value)
  );
}

/** The distinct ids of `{ ids: string[] }`, or null when the body is invalid. */
function readIds(body: unknown): string[] | null {
  if (typeof body !== "object" || body === null) return null;
  const { ids } = body as { ids?: unknown };
  if (!Array.isArray(ids)) return null;
  if (ids.length < 1 || ids.length > MAX_TABS_PER_CLIENT) return null;
  if (!ids.every(isRestorableId)) return null;
  return [...new Set(ids)];
}

/**
 * Restores closed tabs in one request (one rate-limit unit): Undo, close-all
 * Undo and Recently closed all use it.
 */
export async function POST(request: Request) {
  const ip = getClientIpFromHeaders(request.headers);
  const decision = restoreLimiter.check(ip);
  if (!decision.allowed) {
    return rateLimitedResponse(decision, {
      ip,
      route: ROUTE,
      event: "documents_restore_throttled",
    });
  }

  const ids = readIds(await readJsonBody(request, MAX_BODY_BYTES));
  if (!ids) {
    logAbuseEvent("documents_restore_invalid_body", { ip });
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  try {
    const db = openSqlite();
    try {
      bootstrapDocumentActivityTable(db);
      const cutoffMs = closedCutoffMs(Date.now());
      // One transaction for the batch, retried as a whole when busy: a
      // failure never leaves some closures removed behind a 500.
      const results = withBusyRetry(() =>
        restoreClosedDocuments(db, ids, cutoffMs),
      );
      for (const id of ids) {
        if (results[id] === "restored") {
          logAbuseEvent("document_restored", { ip, id });
        }
      }
      return NextResponse.json({ results });
    } finally {
      db.close();
    }
  } catch (err) {
    logAbuseEvent("documents_restore_failed", {
      ip,
      error: err instanceof Error ? err.message : "unknown_error",
    });
    console.error(`[POST ${ROUTE}]`, err);
    return NextResponse.json(
      { error: "Failed to restore documents" },
      { status: 500 },
    );
  }
}
