import type { Database } from "bun:sqlite";
import { createHmac, randomBytes } from "node:crypto";

import { logAbuseEvent } from "@/lib/security/abuse-log";
import { readJsonBody, withBusyRetry } from "@/lib/security/json-body";
import {
  createSlidingWindowLimiter,
  type RateLimitDecision,
  type SlidingWindowLimiter,
} from "@/lib/security/rate-limit";
import { addressKeys } from "@/lib/sharing/failed-tokens";
import {
  authenticateShare,
  SHARE_BUSY,
  type ShareAuthContext,
  type ShareAuthResult,
} from "@/lib/sharing/share-auth";
import type { SharesMode } from "@/lib/sharing/share-config";
import {
  isShareId,
  mintShareId,
  shareDocumentName,
} from "@/lib/sharing/share-name";
import {
  clearOldCreatorIpHashes,
  countActiveShares,
  createShareRow,
  endShare,
  resetShare,
  SHARE_END_REASONS,
  type ShareEndReason,
  setShareViewOnly,
} from "@/lib/sharing/share-store";
import { parseShareHash, readBearerToken } from "@/lib/sharing/share-token";

/**
 * The share HTTP API in the Hocus process (plan §6, P4.2a, c, d):
 *
 * | Route | Auth | |
 * |---|---|---|
 * | `GET /api/info` | none | server limits, schemas and the kill switch |
 * | `POST /api/shares` | none (rate-limited) | create from three client hashes |
 * | `GET /api/shares/:id/status` | any share token | pending, committed or ended |
 * | `DELETE /api/shares/:id` | owner | stop sharing |
 * | `POST /api/shares/:id/reset` | owner | new share id from three new hashes |
 * | `POST /api/shares/:id/view-only` | owner | turn editing off for everyone |
 *
 * Bodies are JSON only (`application/json`, small caps, unknown keys
 * refused). Tokens travel only in `Authorization: Bearer`. Browsers may
 * call from `allowedOrigins` alone (CORS); a mutation from any other
 * `Origin` is refused, which with bearer-only auth and the JSON-only rule
 * (always preflighted) is the CSRF protection. No cookies are read.
 */

const SHARES_PATH = "/api/shares";
const INFO_PATH = "/api/info";
const MAX_CREATE_BODY_BYTES = 1024;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const PREFLIGHT_MAX_AGE_S = 600;
const ALLOWED_METHODS = ["GET", "POST", "DELETE"];
const ALLOWED_HEADERS = "authorization, content-type";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `GET /api/info` (plan §6; seam S3: `apiVersion`, `serverVersion`). */
export type ServerInfo = {
  apiVersion: 1;
  serverVersion: string;
  serverSchema: number;
  minClientSchema: number;
  minDesktopSchema: number;
  allowedSchemas: number[];
  maxDocBytes: number;
  maxFrameBytes: number;
  yjsFormat: 1;
  features: { shares: SharesMode };
};

export type ShareHttpLimits = {
  maxTotalShares: number;
  expiryMs: number;
  ipHashRetentionMs: number;
  mutationsPerMinute: number;
  readsPerMinute: number;
  creationsPerHourPerIp: number;
  creationsPerHour: number;
  /** Lowest and highest client schema a share may be created with. */
  minSchema: number;
  maxSchema: number;
};

export type ShareHttpOptions = {
  auth: ShareAuthContext;
  db: Database;
  mode: Exclude<SharesMode, "off">;
  allowedOrigins: readonly string[];
  limits: ShareHttpLimits;
  info: ServerInfo;
  /** Closes every live connection to a Hocuspocus document. */
  closeDocument: (documentName: string) => void;
  /** HMAC key for `created_ip_hash`; empty means a random key per process. */
  ipHashKey: string;
  now?: () => number;
};

export type ShareHttp = {
  handle(request: Request, ip: string): Promise<Response>;
};

/** Paths the share API owns; with `HOCUS_SHARES=off` they answer 404. */
export function isShareHttpPath(pathname: string): boolean {
  return (
    pathname === INFO_PATH ||
    pathname === SHARES_PATH ||
    pathname.startsWith(`${SHARES_PATH}/`)
  );
}

type Route =
  | { kind: "info" }
  | { kind: "create" }
  | { kind: "status"; shareId: string }
  | { kind: "stop"; shareId: string }
  | { kind: "reset"; shareId: string }
  | { kind: "view-only"; shareId: string }
  | { kind: "not-found" }
  | { kind: "method"; allow: string };

function matchRoute(method: string, pathname: string): Route {
  if (pathname === INFO_PATH) {
    return method === "GET"
      ? { kind: "info" }
      : { kind: "method", allow: "GET" };
  }
  if (pathname === SHARES_PATH) {
    return method === "POST"
      ? { kind: "create" }
      : { kind: "method", allow: "POST" };
  }
  const [shareId, action, ...rest] = pathname
    .slice(SHARES_PATH.length + 1)
    .split("/");
  if (!shareId || !isShareId(shareId) || rest.length > 0) {
    return { kind: "not-found" };
  }
  if (action === undefined) {
    return method === "DELETE"
      ? { kind: "stop", shareId }
      : { kind: "method", allow: "DELETE" };
  }
  const post = (kind: "reset" | "view-only"): Route =>
    method === "POST" ? { kind, shareId } : { kind: "method", allow: "POST" };
  if (action === "status") {
    return method === "GET"
      ? { kind: "status", shareId }
      : { kind: "method", allow: "GET" };
  }
  if (action === "reset") return post("reset");
  if (action === "view-only") return post("view-only");
  return { kind: "not-found" };
}

type NewShareHashes = {
  editHash: Buffer;
  viewHash: Buffer;
  ownerHash: Buffer;
  schema: number;
};

const CREATE_KEYS = [
  "lineage",
  "edit_hash",
  "view_hash",
  "owner_hash",
  "schema",
];
const RESET_KEYS = ["edit_hash", "view_hash", "owner_hash", "schema"];

function hasExactKeys(body: Record<string, unknown>, keys: string[]): boolean {
  const present = Object.keys(body);
  return (
    present.length === keys.length && present.every((key) => keys.includes(key))
  );
}

/**
 * Three distinct 32-byte hashes and a schema in range, or null. The server
 * never accepts a raw secret: anything that is not exactly these keys is
 * refused rather than ignored.
 */
function parseHashes(
  body: Record<string, unknown>,
  limits: ShareHttpLimits,
): NewShareHashes | null {
  const editHash = parseShareHash(body.edit_hash);
  const viewHash = parseShareHash(body.view_hash);
  const ownerHash = parseShareHash(body.owner_hash);
  const schema = body.schema;
  if (!editHash || !viewHash || !ownerHash) return null;
  if (
    editHash.equals(viewHash) ||
    editHash.equals(ownerHash) ||
    viewHash.equals(ownerHash)
  ) {
    return null;
  }
  if (
    typeof schema !== "number" ||
    !Number.isInteger(schema) ||
    schema < limits.minSchema ||
    schema > limits.maxSchema
  ) {
    return null;
  }
  return { editHash, viewHash, ownerHash, schema };
}

function asObject(body: unknown): Record<string, unknown> | null {
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

function isJsonRequest(request: Request): boolean {
  return (
    request.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() ===
    "application/json"
  );
}

function isEndReason(reason: string): reason is ShareEndReason {
  return (SHARE_END_REASONS as readonly string[]).includes(reason);
}

/**
 * Checks `limiter` for every address key of `ip`: the /48 first, then the
 * IPv4 address or /64, so a /48 over its budget adds none of its /64s.
 */
function checkAddress(
  limiter: SlidingWindowLimiter,
  ip: string,
): RateLimitDecision {
  const [own, prefix48] = addressKeys(ip);
  if (prefix48) {
    const decision = limiter.check(prefix48);
    if (!decision.allowed) return decision;
  }
  return limiter.check(own);
}

export function createShareHttp(options: ShareHttpOptions): ShareHttp {
  const now = options.now ?? Date.now;
  const { db, limits } = options;
  const allowedOrigins = new Set(options.allowedOrigins);
  const ipHashKey = options.ipHashKey || randomBytes(32).toString("hex");
  const limiter = (limit: number, windowMs: number): SlidingWindowLimiter =>
    createSlidingWindowLimiter({ limit, windowMs, now });
  const mutations = limiter(limits.mutationsPerMinute, MINUTE_MS);
  const reads = limiter(limits.readsPerMinute, MINUTE_MS);
  const creationsPerIp = limiter(limits.creationsPerHourPerIp, HOUR_MS);
  const creations = limiter(limits.creationsPerHour, HOUR_MS);

  function respond(
    request: Request,
    status: number,
    body: unknown,
    extra: Record<string, string> = {},
  ): Response {
    const headers: Record<string, string> = {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "X-Robots-Tag": "noindex, nofollow",
      Vary: "Origin",
      ...extra,
    };
    const origin = request.headers.get("origin");
    if (origin && allowedOrigins.has(origin)) {
      headers["Access-Control-Allow-Origin"] = origin;
    }
    if (status === 204) return new Response(null, { status, headers });
    return Response.json(body, { status, headers });
  }

  const error = (request: Request, status: number, code: string) =>
    respond(request, status, { error: code });

  function preflight(request: Request): Response {
    const origin = request.headers.get("origin");
    const method = request.headers.get("access-control-request-method") ?? "";
    if (
      !origin ||
      !allowedOrigins.has(origin) ||
      !ALLOWED_METHODS.includes(method)
    ) {
      return error(request, 403, "origin_not_allowed");
    }
    return respond(request, 204, null, {
      "Access-Control-Allow-Methods": ALLOWED_METHODS.join(", "),
      "Access-Control-Allow-Headers": ALLOWED_HEADERS,
      "Access-Control-Max-Age": String(PREFLIGHT_MAX_AGE_S),
    });
  }

  function throttled(
    request: Request,
    decision: { retryAfterSeconds: number },
    ip: string,
    event: string,
  ): Response {
    logAbuseEvent(event, { ip, retry_after_s: decision.retryAfterSeconds });
    return respond(
      request,
      429,
      { error: "rate_limited", retryAfter: decision.retryAfterSeconds },
      { "Retry-After": String(decision.retryAfterSeconds) },
    );
  }

  /** Maps a refused share auth to a response; null when auth passed. */
  function refusal(request: Request, result: ShareAuthResult): Response | null {
    if (result.ok) return null;
    if (result.reason === SHARE_BUSY) {
      return respond(
        request,
        429,
        { error: SHARE_BUSY, retryAfter: 60 },
        { "Retry-After": "60" },
      );
    }
    if (isEndReason(result.reason)) return error(request, 410, result.reason);
    return error(request, 404, "not_found");
  }

  function hashIp(ip: string): string {
    return createHmac("sha256", ipHashKey).update(ip).digest("base64url");
  }

  /** Global cap, then per-IP and global hourly creation limits. */
  function creationRefused(request: Request, ip: string): Response | null {
    const at = now();
    if (countActiveShares(db, at - limits.expiryMs) >= limits.maxTotalShares) {
      logAbuseEvent("share_create_refused", { ip, reason: "shares_full" });
      return error(request, 503, "shares_full");
    }
    const perIp = creationsPerIp.check(ip);
    if (!perIp.allowed) {
      return throttled(request, perIp, ip, "share_create_throttled");
    }
    const global = creations.check("global");
    if (!global.allowed) {
      return throttled(request, global, ip, "share_create_global_throttled");
    }
    return null;
  }

  async function readBody(
    request: Request,
    keys: string[],
  ): Promise<Record<string, unknown> | Response> {
    if (!isJsonRequest(request)) {
      return error(request, 415, "json_required");
    }
    const body = asObject(await readJsonBody(request, MAX_CREATE_BODY_BYTES));
    if (!body || !hasExactKeys(body, keys)) {
      return error(request, 400, "invalid_body");
    }
    return body;
  }

  async function create(request: Request, ip: string): Promise<Response> {
    if (options.mode === "readonly")
      return error(request, 503, "shares_readonly");
    const body = await readBody(request, CREATE_KEYS);
    if (body instanceof Response) return body;
    const hashes = parseHashes(body, limits);
    const lineage = body.lineage;
    if (!hashes || typeof lineage !== "string" || !UUID_REGEX.test(lineage)) {
      return error(request, 400, "invalid_body");
    }
    const refused = creationRefused(request, ip);
    if (refused) return refused;
    const shareId = mintShareId();
    const at = now();
    withBusyRetry(() => {
      createShareRow(
        db,
        {
          shareId,
          lineage: lineage.toLowerCase(),
          ...hashes,
          createdIpHash: hashIp(ip),
        },
        at,
      );
      clearOldCreatorIpHashes(db, at - limits.ipHashRetentionMs);
    });
    console.info(
      JSON.stringify({
        type: "share",
        event: "share_created",
        share_id: shareId,
      }),
    );
    return respond(request, 201, { share_id: shareId });
  }

  function status(request: Request, ip: string, shareId: string): Response {
    const result = authenticateShare(
      options.auth,
      shareId,
      readBearerToken(request.headers),
      ip,
      "any",
    );
    if (!result.ok) {
      return isEndReason(result.reason)
        ? respond(request, 200, { status: "ended", reason: result.reason })
        : (refusal(request, result) as Response);
    }
    return respond(request, 200, {
      status: result.share.status,
      view_only: result.share.view_only === 1,
    });
  }

  function ownerAuth(
    request: Request,
    ip: string,
    shareId: string,
  ): Response | null {
    return refusal(
      request,
      authenticateShare(
        options.auth,
        shareId,
        readBearerToken(request.headers),
        ip,
        "owner",
      ),
    );
  }

  function closeShare(shareId: string): void {
    options.closeDocument(shareDocumentName(shareId));
  }

  function stop(request: Request, ip: string, shareId: string): Response {
    const refused = ownerAuth(request, ip, shareId);
    if (refused) return refused;
    withBusyRetry(() => endShare(db, shareId, "sharing_stopped", now()));
    closeShare(shareId);
    console.info(
      JSON.stringify({
        type: "share",
        event: "share_stopped",
        share_id: shareId,
      }),
    );
    return respond(request, 200, { ended: true });
  }

  function viewOnly(request: Request, ip: string, shareId: string): Response {
    const refused = ownerAuth(request, ip, shareId);
    if (refused) return refused;
    withBusyRetry(() => setShareViewOnly(db, shareId));
    // Edit connections reconnect and are told `view_only`.
    closeShare(shareId);
    return respond(request, 200, { view_only: true });
  }

  async function reset(
    request: Request,
    ip: string,
    shareId: string,
  ): Promise<Response> {
    if (options.mode === "readonly")
      return error(request, 503, "shares_readonly");
    const refused = ownerAuth(request, ip, shareId);
    if (refused) return refused;
    const body = await readBody(request, RESET_KEYS);
    if (body instanceof Response) return body;
    const hashes = parseHashes(body, limits);
    if (!hashes) return error(request, 400, "invalid_body");
    const limited = creationRefused(request, ip);
    if (limited) return limited;
    const nextId = mintShareId();
    const reset = withBusyRetry(() =>
      resetShare(
        db,
        shareId,
        { shareId: nextId, ...hashes, createdIpHash: hashIp(ip) },
        now(),
      ),
    );
    if (!reset) return error(request, 410, "sharing_stopped");
    closeShare(shareId);
    console.info(
      JSON.stringify({
        type: "share",
        event: "share_reset",
        share_id: shareId,
        next_share_id: nextId,
      }),
    );
    return respond(request, 201, { share_id: nextId });
  }

  return {
    async handle(request, ip) {
      if (request.method === "OPTIONS") return preflight(request);
      const route = matchRoute(request.method, new URL(request.url).pathname);
      if (route.kind === "not-found") return error(request, 404, "not_found");
      if (route.kind === "method") {
        return respond(
          request,
          405,
          { error: "method_not_allowed" },
          { Allow: route.allow },
        );
      }

      const isRead = route.kind === "info" || route.kind === "status";
      if (!isRead) {
        const origin = request.headers.get("origin");
        if (origin && !allowedOrigins.has(origin)) {
          logAbuseEvent("share_origin_rejected", { ip, origin });
          return error(request, 403, "origin_not_allowed");
        }
      }
      const decision = checkAddress(isRead ? reads : mutations, ip);
      if (!decision.allowed) {
        return throttled(request, decision, ip, "share_http_throttled");
      }

      try {
        switch (route.kind) {
          case "info":
            return respond(request, 200, options.info);
          case "create":
            return await create(request, ip);
          case "status":
            return status(request, ip, route.shareId);
          case "stop":
            return stop(request, ip, route.shareId);
          case "view-only":
            return viewOnly(request, ip, route.shareId);
          case "reset":
            return await reset(request, ip, route.shareId);
        }
      } catch (err) {
        logAbuseEvent("share_http_failed", {
          ip,
          route: route.kind,
          error: err instanceof Error ? err.message : "unknown_error",
        });
        return error(request, 500, "internal_error");
      }
    },
  };
}
