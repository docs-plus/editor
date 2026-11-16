import { NextResponse } from "next/server";

import { logAbuseEvent } from "@/lib/security/abuse-log";
import { bootstrapDocumentActivityTable } from "@/lib/security/activity-store";
import { getClientIpFromHeaders } from "@/lib/security/client-ip";
import {
  closedCutoffMs,
  listClosedDocuments,
} from "@/lib/security/closed-documents";
import { isTabsDocumentId, TABS_DOC } from "@/lib/security/doc-id-validator";
import {
  CLOSED_DOCUMENTS_LIST,
  CLOSED_RETENTION_DAYS,
  HTTP_MUTATION_RATE_LIMIT_PER_MINUTE,
} from "@/lib/security/guardrail-config";
import { rateLimitedResponse } from "@/lib/security/http-route-guards";
import { createSlidingWindowLimiter } from "@/lib/security/rate-limit";
import { openSqlite } from "@/lib/sqlite-open";

export const dynamic = "force-dynamic";

const ROUTE = "/api/documents/closed";
const ONE_MINUTE_MS = 60_000;
const NO_STORE = { "Cache-Control": "no-store" };
const listLimiter = createSlidingWindowLimiter({
  limit: HTTP_MUTATION_RATE_LIMIT_PER_MINUTE,
  windowMs: ONE_MINUTE_MS,
});

/**
 * Recently closed tabs of one tab list (`?tabs=`), newest first. Anyone
 * using that tab list can see them; `CLOSED_DOCUMENTS_LIST=0` turns it off.
 */
export async function GET(request: Request) {
  const ip = getClientIpFromHeaders(request.headers);
  const decision = listLimiter.check(ip);
  if (!decision.allowed) {
    return rateLimitedResponse(decision, {
      ip,
      route: ROUTE,
      event: "documents_closed_list_throttled",
    });
  }

  if (!CLOSED_DOCUMENTS_LIST) {
    return NextResponse.json(
      { documents: [], retentionDays: CLOSED_RETENTION_DAYS, disabled: true },
      { headers: NO_STORE },
    );
  }

  const requested = new URL(request.url).searchParams.get("tabs") ?? "";
  const tabsDoc = isTabsDocumentId(requested) ? requested : TABS_DOC;

  try {
    const db = openSqlite();
    try {
      bootstrapDocumentActivityTable(db);
      const documents = listClosedDocuments(
        db,
        tabsDoc,
        closedCutoffMs(Date.now()),
      );
      return NextResponse.json(
        { documents, retentionDays: CLOSED_RETENTION_DAYS, disabled: false },
        { headers: NO_STORE },
      );
    } finally {
      db.close();
    }
  } catch (err) {
    logAbuseEvent("documents_closed_list_failed", {
      ip,
      error: err instanceof Error ? err.message : "unknown_error",
    });
    console.error(`[GET ${ROUTE}]`, err);
    return NextResponse.json(
      { error: "Failed to list closed documents" },
      { status: 500, headers: NO_STORE },
    );
  }
}
