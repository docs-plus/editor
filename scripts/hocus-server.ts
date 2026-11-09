import { Hocuspocus } from "@hocuspocus/server";

import { createSqlitePersistence } from "../lib/hocus-persistence";
import { logAbuseEvent } from "../lib/security/abuse-log";
import {
  bootstrapDocumentActivityTable,
  countNonSystemDocuments,
  documentExists,
  upsertDocumentActivity,
} from "../lib/security/activity-store";
import { getPinnedClientIp, pinClientIp } from "../lib/security/client-ip";
import {
  isSystemDocumentId,
  isValidWsDocumentName,
} from "../lib/security/doc-id-validator";
import { buildHocusServerExtensions } from "../lib/security/hocus-server-extensions";
import { createWsGuardrails } from "../lib/security/ws-guardrails";
import { getSqliteDbPath } from "../lib/sqlite-db-path";
import { migrateLegacyMarks } from "../lib/yjs-mark-migration";
import { Database } from "bun:sqlite";

/** Upper bound for flushing and unloading open documents on SIGINT/SIGTERM. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

type SocketData = {
  request: Request;
  connection?: ReturnType<Hocuspocus["handleConnection"]>;
};

function getPort(): number {
  const raw = process.env.HOCUS_PORT?.trim();
  if (!raw) return 1234;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1234;
  return parsed;
}

/**
 * `bun:sqlite`, not better-sqlite3: Bun below 1.4.1 crashes loading the
 * better-sqlite3 13 addon, and this process always runs on Bun.
 */
function openDatabase(path: string): Database {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PUBLIC_HOCUS_URL?.startsWith("ws://")
) {
  throw new Error("Production requires wss:// for NEXT_PUBLIC_HOCUS_URL");
}

const guardrails = createWsGuardrails();
const db = openDatabase(getSqliteDbPath());
bootstrapDocumentActivityTable(db);

const persistence = createSqlitePersistence(db, {
  canStore(documentName, sizeBytes) {
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
    if (!isSystemDocumentId(documentName)) {
      upsertDocumentActivity(db, documentName, sizeBytes);
    }
  },
});

const hocuspocus = new Hocuspocus({
  extensions: buildHocusServerExtensions(persistence),
  async onConnect({ requestHeaders }) {
    const decision = guardrails.onConnect(getPinnedClientIp(requestHeaders));
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
  },
  async onDisconnect({ requestHeaders }) {
    guardrails.onDisconnect(getPinnedClientIp(requestHeaders));
  },
  // Hocuspocus runs this once per document load (concurrent joiners share it).
  async onLoadDocument({ documentName, requestHeaders }) {
    if (!isValidWsDocumentName(documentName)) {
      throw new Error("invalid_document_name");
    }
    if (isSystemDocumentId(documentName) || documentExists(db, documentName)) {
      return;
    }
    const decision = guardrails.canCreateDocument(
      getPinnedClientIp(requestHeaders),
      countNonSystemDocuments(db),
    );
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
  },
  // Runs once per load, after persistence applies the stored state and before
  // any client syncs; the rewrite is persisted through the normal store path.
  async afterLoadDocument({ document, documentName }) {
    const migrated = migrateLegacyMarks(document);
    if (migrated > 0) {
      console.info(
        `[hocus] migrated ${migrated} legacy mark range(s) in "${documentName}"`,
      );
    }
  },
});

const server = Bun.serve<SocketData>({
  port: getPort(),
  fetch(request, server) {
    // Trust boundary: every hook (and Throttle) keys on the IP pinned here.
    const headers = new Headers(request.headers);
    pinClientIp(headers, server.requestIP(request)?.address);
    const data = { request: new Request(request.url, { headers }) };
    if (server.upgrade(request, { data })) return undefined;
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
    open(ws) {
      ws.data.connection = hocuspocus.handleConnection(ws, ws.data.request);
    },
    message(ws, message) {
      ws.data.connection?.handleMessage(
        typeof message === "string" ? Buffer.from(message) : message,
      );
    },
    close(ws, code, reason) {
      ws.data.connection?.handleClose({ code, reason });
    },
    // Pongs keep otherwise silent clients alive, as in @hocuspocus/server's Node Server.
    pong(ws) {
      ws.data.connection?.touch();
    },
  },
});

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
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
