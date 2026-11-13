import { Hocuspocus } from "@hocuspocus/server";

import { createSqlitePersistence } from "../lib/hocus-persistence";
import { logAbuseEvent } from "../lib/security/abuse-log";
import {
  bootstrapDocumentActivityTable,
  countNonSystemDocuments,
  documentExists,
  isTombstoned,
  upsertDocumentActivity,
} from "../lib/security/activity-store";
import { getPinnedClientIp, pinClientIp } from "../lib/security/client-ip";
import {
  clientOutdatedError,
  createClientSchemaCounter,
  isClientOutdated,
  isGateExempt,
  shouldDropOutdatedFrame,
} from "../lib/security/client-schema-gate";
import {
  isSystemDocumentId,
  isValidWsDocumentName,
} from "../lib/security/doc-id-validator";
import { BROADCAST_FLUSH_OPTIONS } from "../lib/security/editor-root-sweep";
import {
  HOCUS_ALLOW_ISOLATED_TABS_DOCS,
  HOCUS_ALLOWED_ORIGINS,
  HOCUS_AUTH_TIMEOUT_MS,
  HOCUS_BACKPRESSURE_LIMIT_BYTES,
  HOCUS_HOST,
  HOCUS_MAX_PAYLOAD_BYTES,
  HOCUS_MIN_CLIENT_SCHEMA,
  MAX_AWARENESS_STATE_BYTES,
  MAX_WS_SOCKETS,
  WS_SOCKETS_PER_IP,
  WS_UPGRADE_RATE_LIMIT_PER_MINUTE,
} from "../lib/security/guardrail-config";
import { DocumentGuard } from "../lib/security/hocus-document-guard";
import { buildHocusServerExtensions } from "../lib/security/hocus-server-extensions";
import { createWsGuardrails } from "../lib/security/ws-guardrails";
import { createSocketGate } from "../lib/security/ws-socket-gate";
import { openSqlite } from "../lib/sqlite-open";
import { migrateLegacyMarks } from "../lib/yjs-mark-migration";

/** Upper bound for flushing and unloading open documents on SIGINT/SIGTERM. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

type SocketData = {
  request: Request;
  ip: string;
  connection?: ReturnType<Hocuspocus["handleConnection"]>;
  authTimer?: ReturnType<typeof setTimeout>;
  /**
   * The socket URL's `schema` is below `HOCUS_MIN_CLIENT_SCHEMA`, so every
   * gated document on it is refused. Judged once at upgrade (the URL cannot
   * change) and freed with the socket.
   */
  outdated: boolean;
};

function getPort(): number {
  const raw = process.env.HOCUS_PORT?.trim();
  if (!raw) return 1234;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1234;
  return parsed;
}

/**
 * A rejection the client sees as a reason, logged once as a structured
 * abuse event instead of a stack trace per attempt.
 */
function reject(
  reason: string,
  details: Record<string, unknown>,
): Error & { reason: string } {
  logAbuseEvent("ws_guardrail_rejected", { reason, ...details });
  const error = Object.assign(new Error(reason), { reason });
  error.stack = "";
  return error;
}

if (process.env.NODE_ENV === "production") {
  if (process.env.NEXT_PUBLIC_HOCUS_URL?.startsWith("ws://")) {
    throw new Error("Production requires wss:// for NEXT_PUBLIC_HOCUS_URL");
  }
  if (HOCUS_ALLOW_ISOLATED_TABS_DOCS) {
    throw new Error(
      "HOCUS_ALLOW_ISOLATED_TABS_DOCS is a test-only flag; unset it in production",
    );
  }
  if (HOCUS_ALLOWED_ORIGINS.length === 0) {
    console.warn(
      "[hocus] HOCUS_ALLOWED_ORIGINS is empty: any website can open sockets",
    );
  }
}

const guardrails = createWsGuardrails();
const socketGate = createSocketGate({
  socketsPerIp: WS_SOCKETS_PER_IP,
  maxSockets: MAX_WS_SOCKETS,
  upgradesPerMinute: WS_UPGRADE_RATE_LIMIT_PER_MINUTE,
  allowedOrigins: HOCUS_ALLOWED_ORIGINS,
});
const clientSchemaCounter = createClientSchemaCounter();
const db = openSqlite();
bootstrapDocumentActivityTable(db);
const documentGuard = new DocumentGuard({
  maxDocumentBytes: guardrails.maxDocumentBytes,
  maxAwarenessStateBytes: MAX_AWARENESS_STATE_BYTES,
  isDeletedDocument: (name) => isTombstoned(db, name),
});

const persistence = createSqlitePersistence(db, {
  canStore(documentName, sizeBytes) {
    if (isTombstoned(db, documentName)) {
      return { allowed: false, reason: "document_deleted" };
    }
    const decision = guardrails.canStoreDocument(documentName, sizeBytes);
    if (!decision.allowed) {
      logAbuseEvent("document_store_rejected", {
        documentName,
        sizeBytes,
        reason: decision.reason,
      });
    }
    return decision;
  },
  onStored(documentName, sizeBytes) {
    documentGuard.recordStored(documentName, sizeBytes);
    if (!isSystemDocumentId(documentName)) {
      upsertDocumentActivity(db, documentName, sizeBytes);
    }
  },
});

const hocuspocus = new Hocuspocus({
  // No early flush: the root sweep must reach clients with the update it fixes.
  ...BROADCAST_FLUSH_OPTIONS,
  extensions: buildHocusServerExtensions(persistence, documentGuard),
  // Checks only: a connection counts once it is established (`connected`),
  // so attempts whose document load fails never leak a slot.
  async onConnect({ requestHeaders, requestParameters, documentName }) {
    const ip = getPinnedClientIp(requestHeaders);
    // Also when the document is still in memory (onLoadDocument is skipped),
    // so a reconnecting offline copy cannot reach a deleted document.
    if (isTombstoned(db, documentName)) {
      throw reject("document_deleted", { ip, documentName });
    }
    // Outdated bundles must not write with a schema the server no longer
    // accepts. Not abuse: counted in the aggregate, never logged per attempt.
    if (!isGateExempt(documentName)) {
      const outdated = isClientOutdated(
        requestParameters.get("schema"),
        HOCUS_MIN_CLIENT_SCHEMA,
      );
      clientSchemaCounter.record(requestParameters, outdated);
      if (outdated) throw clientOutdatedError();
    }
    const decision = guardrails.canConnect(ip);
    if (!decision.allowed) {
      throw reject(decision.reason, { ip, documentName });
    }
  },
  async connected({ requestHeaders }) {
    guardrails.onConnected(getPinnedClientIp(requestHeaders));
  },
  async onDisconnect({ requestHeaders }) {
    guardrails.onDisconnect(getPinnedClientIp(requestHeaders));
  },
  // Hocuspocus runs this once per document load (concurrent joiners share it).
  async onLoadDocument({ documentName, requestHeaders }) {
    const ip = getPinnedClientIp(requestHeaders);
    if (!isValidWsDocumentName(documentName)) {
      throw reject("invalid_document_name", {
        ip,
        documentName: documentName.slice(0, 80),
      });
    }
    if (isTombstoned(db, documentName)) {
      throw reject("document_deleted", { ip, documentName });
    }
    if (isSystemDocumentId(documentName) || documentExists(db, documentName)) {
      return;
    }
    const decision = guardrails.canCreateDocument(
      ip,
      countNonSystemDocuments(db),
    );
    if (!decision.allowed) {
      throw reject(decision.reason, { ip, documentName });
    }
  },
  // Runs once per load, after persistence applies the stored state and before
  // any client syncs; the rewrite is persisted through the normal store path.
  async afterLoadDocument({ document, documentName }) {
    const migrated = migrateLegacyMarks(document);
    if (migrated > 0) {
      console.info(
        `[hocus] migrated ${migrated} legacy mark range(s) in ${JSON.stringify(documentName)}`,
      );
    }
  },
});

const server = Bun.serve<SocketData>({
  hostname: HOCUS_HOST,
  port: getPort(),
  fetch(request, server) {
    // Trust boundary: every hook (and Throttle) keys on the IP pinned here.
    const headers = new Headers(request.headers);
    const ip = pinClientIp(headers, server.requestIP(request)?.address);

    if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const admission = socketGate.admit(ip, request.headers.get("origin"));
      if (!admission.allowed) {
        logAbuseEvent("ws_upgrade_rejected", {
          ip,
          reason: admission.reason,
          origin: request.headers.get("origin"),
        });
        return new Response(admission.reason, { status: admission.status });
      }
      const data: SocketData = {
        request: new Request(request.url, { headers }),
        ip,
        outdated: isClientOutdated(
          new URL(request.url).searchParams.get("schema"),
          HOCUS_MIN_CLIENT_SCHEMA,
        ),
      };
      if (server.upgrade(request, { data })) {
        socketGate.opened(ip);
        return undefined;
      }
    }

    // Plain HTTP is only a health check: keep it out of search results.
    const noindex = { "X-Robots-Tag": "noindex, nofollow" };
    if (new URL(request.url).pathname === "/robots.txt") {
      return new Response("User-agent: *\nDisallow: /\n", {
        headers: { ...noindex, "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    return new Response("ok", { headers: noindex });
  },
  websocket: {
    // Frames above this close with 1009 before Hocuspocus decodes them.
    maxPayloadLength: HOCUS_MAX_PAYLOAD_BYTES,
    backpressureLimit: HOCUS_BACKPRESSURE_LIMIT_BYTES,
    closeOnBackpressureLimit: true,
    open(ws) {
      ws.data.connection = hocuspocus.handleConnection(ws, ws.data.request);
      // Sockets that never authenticate would otherwise stay open forever.
      ws.data.authTimer = setTimeout(() => {
        logAbuseEvent("ws_auth_timeout", { ip: ws.data.ip });
        ws.close(4408, "auth_timeout");
      }, HOCUS_AUTH_TIMEOUT_MS);
    },
    message(ws, message) {
      const frame =
        typeof message === "string" ? Buffer.from(message) : message;
      // Refused documents keep sending sync and awareness; queued unauthenticated,
      // they would reset the whole socket (tab list included) at 1,000 frames.
      // Only outdated sockets parse headers, so the hot path is unchanged.
      if (ws.data.outdated && shouldDropOutdatedFrame(frame)) return;
      if (ws.data.authTimer) {
        clearTimeout(ws.data.authTimer);
        ws.data.authTimer = undefined;
      }
      ws.data.connection?.handleMessage(frame);
    },
    close(ws, code, reason) {
      clearTimeout(ws.data.authTimer);
      socketGate.closed(ws.data.ip);
      ws.data.connection?.handleClose({ code, reason });
    },
    // Pongs keep otherwise silent clients alive, as in @hocuspocus/server's Node Server.
    pong(ws) {
      ws.data.connection?.touch();
    },
  },
});

console.log(
  `[hocus] client schema gate: min=${HOCUS_MIN_CLIENT_SCHEMA}${HOCUS_MIN_CLIENT_SCHEMA === 0 ? " (log only)" : ""}`,
);
console.log(`Hocuspocus listening on ws://${server.hostname}:${server.port}`);

let shuttingDown = false;

/** Mirrors `Server.destroy()`: close sockets, flush debounced stores, wait for unload. */
async function shutdown(): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  server.stop();
  hocuspocus.closeConnections();
  hocuspocus.flushPendingStores();

  const deadline = Date.now() + SHUTDOWN_TIMEOUT_MS;
  while (hocuspocus.getDocumentsCount() > 0 && Date.now() < deadline) {
    await Bun.sleep(50);
  }

  await hocuspocus.hooks("onDestroy", { instance: hocuspocus });
  db.close();
  clientSchemaCounter.stop();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Test harnesses spawn the server with a stdin pipe and set this flag, so
// it shuts down when its parent dies, even by SIGKILL (no orphans). Off for
// `make dev` and PM2, whose stdin may be closed from the start.
if (process.env.HOCUS_EXIT_ON_STDIN_EOF === "1") {
  void (async () => {
    for await (const _ of Bun.stdin.stream()) {
      // The parent never writes; only the end of the stream matters.
    }
    await shutdown();
  })();
}
