import type Database from "better-sqlite3";
import { NextResponse } from "next/server";

import { PLAYGROUND_ID } from "@/lib/constants";
import { logAbuseEvent } from "@/lib/security/abuse-log";
import { getClientIpFromHeaders } from "@/lib/security/client-ip";
import { isValidUserDocumentId } from "@/lib/security/doc-id-validator";
import { HTTP_MUTATION_RATE_LIMIT_PER_MINUTE } from "@/lib/security/guardrail-config";
import { createSlidingWindowLimiter } from "@/lib/security/rate-limit";
import { openBetterSqlite, SQLITE_BUSY } from "@/lib/sqlite-open";

const MAX_RETRIES = 3;
const ONE_MINUTE_MS = 60_000;
const deleteLimiter = createSlidingWindowLimiter({
  limit: HTTP_MUTATION_RATE_LIMIT_PER_MINUTE,
  windowMs: ONE_MINUTE_MS,
});

function deleteWithRetry(db: Database.Database, id: string): boolean {
  const stmt = db.prepare("DELETE FROM documents WHERE name = ?");
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const result = stmt.run(id);
      return result.changes > 0;
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === SQLITE_BUSY && attempt < MAX_RETRIES - 1) continue;
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

  if (id === PLAYGROUND_ID) {
    logAbuseEvent("documents_delete_playground_rejected", { ip, id });
    return NextResponse.json(
      { error: "Cannot delete playground document" },
      { status: 400 },
    );
  }

  if (!isValidUserDocumentId(id)) {
    logAbuseEvent("documents_delete_invalid_id", { ip, id });
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
  }

  try {
    const db = openBetterSqlite({ timeoutMs: 5000 });
    try {
      const deleted = deleteWithRetry(db, id);
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
