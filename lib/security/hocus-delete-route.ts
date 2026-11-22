import type { Database } from "bun:sqlite";

import { logAbuseEvent } from "@/lib/security/abuse-log";
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
import { readJsonBody, withBusyRetry } from "@/lib/security/json-body";
import {
  createSlidingWindowLimiter,
  type SlidingWindowLimiter,
} from "@/lib/security/rate-limit";
import { isReservedSyncName, isShareNamespace } from "@/lib/sharing/share-name";

/**
 * `DELETE /api/documents/:id` served by the Hocus process (P4.1). Same
 * contract as the Next.js route it replaces (status codes, bodies, the soft
 * close), plus an explicit refusal of `share:*` and `sync:*` names. Off
 * until `HOCUS_DELETE_ROUTE=on` and the Traefik route moves; then the
 * Next.js route is deleted in a follow-up.
 */
export const DOCUMENTS_PATH_PREFIX = "/api/documents/";

const ONE_MINUTE_MS = 60_000;
const MAX_BODY_BYTES = 1024;
const ROUTE = "/api/documents/[id]";

export type HocusDeleteRoute = {
  handle(request: Request, ip: string): Promise<Response>;
};

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

/** The `:id` segment, decoded, or null for any other path shape. */
function documentIdFromPath(pathname: string): string | null {
  const raw = pathname.slice(DOCUMENTS_PATH_PREFIX.length);
  if (!raw || raw.includes("/")) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

const json = (body: unknown, init: ResponseInit = {}) =>
  Response.json(body, init);

export function createHocusDeleteRoute(options: {
  db: Database;
  limiter?: SlidingWindowLimiter;
}): HocusDeleteRoute {
  const limiter =
    options.limiter ??
    createSlidingWindowLimiter({
      limit: HTTP_MUTATION_RATE_LIMIT_PER_MINUTE,
      windowMs: ONE_MINUTE_MS,
    });

  return {
    async handle(request, ip) {
      if (request.method !== "DELETE") {
        return json(
          { error: "Method not allowed" },
          { status: 405, headers: { Allow: "DELETE" } },
        );
      }
      const decision = limiter.check(ip);
      if (!decision.allowed) {
        logAbuseEvent("documents_delete_throttled", {
          ip,
          route: ROUTE,
          retry_after_s: decision.retryAfterSeconds,
        });
        return json(
          {
            error: "Rate limit exceeded",
            retryAfter: decision.retryAfterSeconds,
          },
          {
            status: 429,
            headers: { "Retry-After": String(decision.retryAfterSeconds) },
          },
        );
      }

      const id = documentIdFromPath(new URL(request.url).pathname);
      if (id === null) {
        logAbuseEvent("documents_delete_invalid_id", { ip });
        return json({ error: "Invalid document id" }, { status: 400 });
      }
      if (isSystemDocumentId(id)) {
        logAbuseEvent("documents_delete_system_rejected", { ip, id });
        return json(
          { error: "Cannot delete a shared system document" },
          { status: 400 },
        );
      }
      // Shares end only through their owner endpoints; sync is reserved.
      if (isShareNamespace(id) || isReservedSyncName(id)) {
        logAbuseEvent("documents_delete_share_rejected", {
          ip,
          id: id.slice(0, 80),
        });
        return json({ error: "Invalid document id" }, { status: 400 });
      }
      if (!isValidUserDocumentId(id)) {
        logAbuseEvent("documents_delete_invalid_id", {
          ip,
          id: id.slice(0, 80),
        });
        return json({ error: "Invalid document id" }, { status: 400 });
      }

      const { title, tabsDoc } = readCloseBody(
        await readJsonBody(request, MAX_BODY_BYTES),
      );
      try {
        const result = withBusyRetry(() =>
          closeDocumentSoftly(options.db, id, title, tabsDoc),
        );
        const closed = result === "closed";
        logAbuseEvent("document_closed", { ip, id, tabsDoc, closed });
        return json({ closed });
      } catch (err) {
        logAbuseEvent("documents_delete_failed", {
          ip,
          id,
          error: err instanceof Error ? err.message : "unknown_error",
        });
        console.error("[DELETE /api/documents]", err);
        return json({ error: "Failed to close document" }, { status: 500 });
      }
    },
  };
}
