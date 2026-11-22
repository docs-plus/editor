import type { Database } from "bun:sqlite";

import { ResetConnection } from "@hocuspocus/common";
import type {
  beforeHandleAwarenessPayload,
  connectedPayload,
  Extension,
  onAuthenticatePayload,
} from "@hocuspocus/server";

import { logAbuseEvent } from "@/lib/security/abuse-log";
import { getPinnedClientIp } from "@/lib/security/client-ip";
import {
  clientOutdatedRefusal,
  isClientOutdated,
} from "@/lib/security/client-schema-gate";
import { guardrailRefusal } from "@/lib/security/guardrail-refusal";
import { withBusyRetry } from "@/lib/security/json-body";
import { createFailedTokenLimiter } from "@/lib/sharing/failed-tokens";
import {
  authenticateShare,
  SHARE_BUSY,
  SHARE_UNAVAILABLE,
  type ShareAuthContext,
} from "@/lib/sharing/share-auth";
import {
  HOCUS_SHARE_ORIGINS,
  MAX_TOTAL_SHARES,
  SHARE_CREATION_RATE_LIMIT_PER_HOUR,
  SHARE_EXPIRY_DAYS,
  SHARE_FAILED_TOKENS_PER_PREFIX,
  SHARE_FAILED_TOKENS_PER_SHARE,
  SHARE_GLOBAL_CREATION_LIMIT_PER_HOUR,
  SHARE_IP_HASH_KEY,
  SHARE_IP_HASH_RETENTION_DAYS,
  SHARE_READ_RATE_LIMIT_PER_MINUTE,
  SHARE_SCHEMA_FLOOR,
  SHARE_WS_CONNECTIONS_PER_IP,
  type SharesMode,
} from "@/lib/sharing/share-config";
import {
  createShareHttp,
  type ServerInfo,
  type ShareHttp,
} from "@/lib/sharing/share-http";
import {
  isShareNamespace,
  shareDocumentName,
  shareIdFromDocumentName,
} from "@/lib/sharing/share-name";
import {
  bootstrapSharesTable,
  clearOldCreatorIpHashes,
  getShare,
  recordShareStored,
} from "@/lib/sharing/share-store";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Connection context for share documents, set by `onAuthenticate`. */
export type ShareConnectionContext = { shareReadOnly?: boolean };

export type ShareServerOptions = {
  db: Database;
  mode: Exclude<SharesMode, "off">;
  /** The sandbox gate's minimum; shares use `max(this, SHARE_SCHEMA_FLOOR)`. */
  minClientSchema: number;
  /** Highest client schema the server knows (`CLIENT_SCHEMA`). */
  serverSchema: number;
  serverVersion: string;
  maxDocBytes: number;
  maxFrameBytes: number;
  mutationsPerMinute: number;
  closeDocument: (documentName: string) => void;
  now?: () => number;
};

export type ShareServer = {
  http: ShareHttp;
  info: ServerInfo;
  /** `onConnect` for `share:*`: name, schema floor and capacity. Throws a refusal. */
  checkConnect(
    documentName: string,
    headers: Headers,
    params: URLSearchParams,
  ): void;
  /** `onAuthenticate` for `share:*`: returns context, throws a refusal. */
  authenticate(payload: onAuthenticatePayload): ShareConnectionContext;
  /** `onLoadDocument` for `share:*`: never creates a share without its row. */
  checkLoad(documentName: string, headers: Headers): void;
  recordStored(documentName: string, sizeBytes: number): void;
  /**
   * `connected` for `share:*`: counts the connection, then checks the row
   * again and closes the connection if the share ended (or an editor's
   * share went view-only) while it was joining. A stop or view-only call
   * that ran between `onAuthenticate` and here found no connection to close.
   */
  onConnected(payload: connectedPayload<ShareConnectionContext>): void;
  onDisconnect(ip: string): void;
  /** Marks viewers in awareness: no cursor, `viewer: true` (details §8.2). */
  awareness: Extension;
  /** Hourly upkeep, also run at start: clears old `created_ip_hash` values. */
  sweep(): void;
  /** Stops the sweep timer. */
  stop(): void;
};

const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Wires the share server into the Hocus process. Created only when
 * `HOCUS_SHARES` is not `off`: creating it bootstraps the `shares` table.
 */
export function createShareServer(options: ShareServerOptions): ShareServer {
  const { db, mode } = options;
  bootstrapSharesTable(db);
  const now = options.now ?? Date.now;
  const expiryMs = SHARE_EXPIRY_DAYS * DAY_MS;
  const shareMinSchema = Math.max(options.minClientSchema, SHARE_SCHEMA_FLOOR);
  const maxSchema = Math.max(options.serverSchema, SHARE_SCHEMA_FLOOR);
  const auth: ShareAuthContext = {
    db,
    mode,
    expiryMs,
    now,
    failedTokens: createFailedTokenLimiter({
      perShare: SHARE_FAILED_TOKENS_PER_SHARE,
      perPrefix: SHARE_FAILED_TOKENS_PER_PREFIX,
      now,
    }),
    onEnded: (shareId) => options.closeDocument(shareDocumentName(shareId)),
  };
  const info: ServerInfo = {
    apiVersion: 1,
    serverVersion: options.serverVersion,
    serverSchema: options.serverSchema,
    minClientSchema: options.minClientSchema,
    minDesktopSchema: SHARE_SCHEMA_FLOOR,
    allowedSchemas: Array.from(
      { length: maxSchema - options.minClientSchema + 1 },
      (_, i) => options.minClientSchema + i,
    ),
    maxDocBytes: options.maxDocBytes,
    maxFrameBytes: options.maxFrameBytes,
    yjsFormat: 1,
    features: { shares: mode },
  };
  const http = createShareHttp({
    auth,
    db,
    mode,
    allowedOrigins: HOCUS_SHARE_ORIGINS,
    info,
    closeDocument: options.closeDocument,
    ipHashKey: SHARE_IP_HASH_KEY,
    now,
    limits: {
      maxTotalShares: MAX_TOTAL_SHARES,
      expiryMs,
      mutationsPerMinute: options.mutationsPerMinute,
      readsPerMinute: SHARE_READ_RATE_LIMIT_PER_MINUTE,
      creationsPerHourPerIp: SHARE_CREATION_RATE_LIMIT_PER_HOUR,
      creationsPerHour: SHARE_GLOBAL_CREATION_LIMIT_PER_HOUR,
      minSchema: SHARE_SCHEMA_FLOOR,
      maxSchema,
    },
  });
  const activeConnections = new Map<string, number>();
  const ipHashRetentionMs = SHARE_IP_HASH_RETENTION_DAYS * DAY_MS;
  const sweep = () => {
    withBusyRetry(() => clearOldCreatorIpHashes(db, now() - ipHashRetentionMs));
  };
  sweep();
  const sweepTimer = setInterval(() => {
    try {
      sweep();
    } catch (err) {
      logAbuseEvent("share_sweep_failed", {
        error: err instanceof Error ? err.message : "unknown_error",
      });
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  return {
    sweep,
    stop: () => clearInterval(sweepTimer),
    http,
    info,
    checkConnect(documentName, headers, params) {
      const ip = getPinnedClientIp(headers);
      const shareId = shareIdFromDocumentName(documentName);
      if (!shareId) {
        throw guardrailRefusal("invalid_document_name", {
          ip,
          documentName: documentName.slice(0, 80),
        });
      }
      if (isClientOutdated(params.get("schema"), shareMinSchema)) {
        throw clientOutdatedRefusal();
      }
      if ((activeConnections.get(ip) ?? 0) >= SHARE_WS_CONNECTIONS_PER_IP) {
        throw guardrailRefusal(SHARE_BUSY, { ip, share_id: shareId });
      }
    },
    authenticate({ documentName, token, requestHeaders, connectionConfig }) {
      const ip = getPinnedClientIp(requestHeaders);
      const shareId = shareIdFromDocumentName(documentName);
      const result = shareId
        ? authenticateShare(auth, shareId, token || null, ip, "connection")
        : ({ ok: false, reason: SHARE_UNAVAILABLE } as const);
      if (!result.ok) {
        throw guardrailRefusal(result.reason, { ip, share_id: shareId });
      }
      connectionConfig.readOnly = result.readOnly;
      return { shareReadOnly: result.readOnly };
    },
    checkLoad(documentName, headers) {
      const shareId = shareIdFromDocumentName(documentName);
      const share = shareId ? getShare(db, shareId) : null;
      if (!share || share.status === "ended") {
        throw guardrailRefusal(SHARE_UNAVAILABLE, {
          ip: getPinnedClientIp(headers),
          share_id: shareId,
        });
      }
    },
    recordStored(documentName, sizeBytes) {
      const shareId = shareIdFromDocumentName(documentName);
      if (shareId) recordShareStored(db, shareId, sizeBytes, now());
    },
    onConnected({ requestHeaders, documentName, context, connection }) {
      const ip = getPinnedClientIp(requestHeaders);
      // Counted first: closing runs `onDisconnect`, which counts it down.
      activeConnections.set(ip, (activeConnections.get(ip) ?? 0) + 1);
      const shareId = shareIdFromDocumentName(documentName);
      const share = shareId ? getShare(db, shareId) : null;
      const stale =
        !share ||
        share.status === "ended" ||
        (share.view_only === 1 && !context?.shareReadOnly);
      // It reconnects and is told why (`sharing_stopped`, `view_only`, …).
      if (stale) connection.close(ResetConnection);
    },
    onDisconnect(ip) {
      const active = activeConnections.get(ip) ?? 0;
      if (active <= 1) activeConnections.delete(ip);
      else activeConnections.set(ip, active - 1);
    },
    awareness: {
      async beforeHandleAwareness({
        documentName,
        context,
        states,
      }: beforeHandleAwarenessPayload<ShareConnectionContext>) {
        if (!isShareNamespace(documentName) || !context) return;
        for (const state of states.values()) {
          if (!state || typeof state !== "object") continue;
          if (context.shareReadOnly) {
            delete state.cursor;
            state.viewer = true;
          } else {
            // Only the server marks viewers.
            delete state.viewer;
          }
        }
      },
    },
  };
}
