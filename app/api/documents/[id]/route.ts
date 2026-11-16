import { NextResponse } from "next/server";

import { logAbuseEvent } from "@/lib/security/abuse-log";
import { bootstrapDocumentActivityTable } from "@/lib/security/activity-store";
import { getClientIpFromHeaders } from "@/lib/security/client-ip";
import {
  cleanClosedTitle,
  closeDocumentSoftly,
} from "@/lib/security/closed-documents";
import {
  isSystemDocumentId,
  isTabsDocumentId,
  isValidUserDocumentId,
  TABS_DOC,
} from "@/lib/security/doc-id-validator";
import { HTTP_MUTATION_RATE_LIMIT_PER_MINUTE } from "@/lib/security/guardrail-config";
import {
  rateLimitedResponse,
  readJsonBody,
  withBusyRetry,
} from "@/lib/security/http-route-guards";
import { createSlidingWindowLimiter } from "@/lib/security/rate-limit";
import { openSqlite } from "@/lib/sqlite-open";

const ONE_MINUTE_MS = 60_000;
const MAX_BODY_BYTES = 1024;
const deleteLimiter = createSlidingWindowLimiter({
  limit: HTTP_MUTATION_RATE_LIMIT_PER_MINUTE,
  windowMs: ONE_MINUTE_MS,
});

function readCloseBody(body: unknown): { title: string; tabsDoc: string } {
  const fields =
    typeof body === "object" && body !== null
      ? (body as Record<string, unknown>)
      : {};
  const tabsDoc =
    typeof fields.tabsDoc === "string" && isTabsDocumentId(fields.tabsDoc)
      ? fields.tabsDoc
      : TABS_DOC;
  return { title: cleanClosedTitle(fields.title), tabsDoc };
}

/**
 * Closes a tab softly: the document stays stored and restorable for
 * `CLOSED_RETENTION_DAYS`, then the retention purge deletes and tombstones
 * it. Older bundles send no body and only check `ok || 404`.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const ip = getClientIpFromHeaders(request.headers);
  const decision = deleteLimiter.check(ip);
  if (!decision.allowed) {
    return rateLimitedResponse(decision, {
      ip,
      route: "/api/documents/[id]",
      event: "documents_delete_throttled",
    });
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

  const { title, tabsDoc } = readCloseBody(
    await readJsonBody(request, MAX_BODY_BYTES),
  );

  try {
    const db = openSqlite();
    try {
      bootstrapDocumentActivityTable(db);
      const result = withBusyRetry(() =>
        closeDocumentSoftly(db, id, title, tabsDoc),
      );
      const closed = result === "closed";
      logAbuseEvent("document_closed", { ip, id, tabsDoc, closed });
      return NextResponse.json({ closed });
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
      { error: "Failed to close document" },
      { status: 500 },
    );
  }
}
