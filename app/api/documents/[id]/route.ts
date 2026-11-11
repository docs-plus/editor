import type { Database } from "bun:sqlite";

import { NextResponse } from "next/server";

import { logAbuseEvent } from "@/lib/security/abuse-log";
import {
  bootstrapDocumentActivityTable,
  deleteDocumentPermanently,
} from "@/lib/security/activity-store";
import { getClientIpFromHeaders } from "@/lib/security/client-ip";
import {
  isSystemDocumentId,
  isValidUserDocumentId,
} from "@/lib/security/doc-id-validator";
import { HTTP_MUTATION_RATE_LIMIT_PER_MINUTE } from "@/lib/security/guardrail-config";
import { createSlidingWindowLimiter } from "@/lib/security/rate-limit";
import { isSqliteBusyError, openSqlite } from "@/lib/sqlite-open";

const MAX_RETRIES = 3;
const ONE_MINUTE_MS = 60_000;
const deleteLimiter = createSlidingWindowLimiter({
  limit: HTTP_MUTATION_RATE_LIMIT_PER_MINUTE,
  windowMs: ONE_MINUTE_MS,
});

function deleteWithRetry(db: Database, id: string): boolean {
  bootstrapDocumentActivityTable(db);
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return deleteDocumentPermanently(db, id);
    } catch (err) {
      if (isSqliteBusyError(err) && attempt < MAX_RETRIES - 1) continue;
      throw err;
    }
  }
  return false; // Unreachable; satisfies TypeScript control flow
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ip = getClientIpFromHeaders(request.headers);
  const decision = deleteLimiter.check(ip);
  if (!decision.allowed) {
    logAbuseEvent("documents_delete_throttled", {
      ip,
      route: "/api/documents/[id]",
      retry_after_s: decision.retryAfterSeconds,
    });
    return NextResponse.json(
      { error: "Rate limit exceeded", retryAfter: decision.retryAfterSeconds },
      {
        status: 429,
        headers: { "Retry-After": String(decision.retryAfterSeconds) },
      },
    );
  }

  if (isSystemDocumentId(id)) {
    logAbuseEvent("documents_delete_system_rejected", { ip, id });
    return NextResponse.json(
      { error: "Cannot delete a shared system document" },
      { status: 400 },
    );
  }

  if (!isValidUserDocumentId(id)) {
    logAbuseEvent("documents_delete_invalid_id", { ip, id });
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
  }

  try {
    const db = openSqlite();
    try {
      const deleted = deleteWithRetry(db, id);
      logAbuseEvent("document_deleted", { ip, id, existed: deleted });
      return NextResponse.json({ deleted }, { status: deleted ? 200 : 404 });
    } finally {
      db.close();
    }
  } catch (err) {
    logAbuseEvent("documents_delete_failed", {
      ip,
      id,
      error: err instanceof Error ? err.message : "unknown_error",
    });
    console.error("[DELETE /api/documents]", err);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 },
    );
  }
}
