import { Server } from "@hocuspocus/server";
import sqlite3 from "sqlite3";

import { getClientIpFromHeaders } from "../lib/security/client-ip";
import {
  isSystemDocumentId,
  isValidWsDocumentName,
} from "../lib/security/doc-id-validator";
import { buildHocusServerExtensions } from "../lib/security/hocus-server-extensions";
import { createWsGuardrails } from "../lib/security/ws-guardrails";
import { getSqliteDbPath } from "../lib/sqlite-db-path";

function getPort(): number {
  const raw = process.env.HOCUS_PORT?.trim();
  if (!raw) return 1234;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 1234;
  return parsed;
}

function createMetadataDb(dbPath: string): sqlite3.Database {
  const db = new sqlite3.Database(dbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  return db;
}

function runSql(
  db: sqlite3.Database,
  sql: string,
  params: Array<string | number> = [],
): Promise<void> {
  return new Promise((resolve, reject) => {
    db.run(sql, params, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function getSql<T extends object>(
  db: sqlite3.Database,
  sql: string,
  params: Array<string | number> = [],
): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
      if (error) reject(error);
      else resolve(row as T | undefined);
    });
  });
}

async function bootstrapMetadataTable(db: sqlite3.Database): Promise<void> {
  await runSql(
    db,
    `
      CREATE TABLE IF NOT EXISTS document_activity (
        name TEXT PRIMARY KEY,
        last_persisted_at INTEGER NOT NULL,
        last_size_bytes INTEGER NOT NULL DEFAULT 0
      )
    `,
  );
}

async function documentExists(
  db: sqlite3.Database,
  name: string,
): Promise<boolean> {
  const row = await getSql<{ exists: number }>(
    db,
    "SELECT 1 AS exists FROM documents WHERE name = ? LIMIT 1",
    [name],
  );
  return Boolean(row?.exists);
}

async function countNonSystemDocuments(db: sqlite3.Database): Promise<number> {
  const row = await getSql<{ count: number }>(
    db,
    `
      SELECT COUNT(*) AS count
      FROM documents
      WHERE name != 'playground'
        AND name != 'global-tabs'
        AND name NOT LIKE 'global-tabs-%'
    `,
  );
  return row?.count ?? 0;
}

async function upsertDocumentActivity(
  db: sqlite3.Database,
  name: string,
  sizeBytes: number,
): Promise<void> {
  const now = Date.now();
  await runSql(
    db,
    `
      INSERT INTO document_activity (name, last_persisted_at, last_size_bytes)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        last_persisted_at = excluded.last_persisted_at,
        last_size_bytes = excluded.last_size_bytes
    `,
    [name, now, sizeBytes],
  );
}

function headersFromUnknown(value: unknown): Headers {
  if (value instanceof Headers) return value;
  const headers = new Headers();
  if (value && typeof value === "object") {
    for (const [key, raw] of Object.entries(value)) {
      if (typeof raw === "string") headers.set(key, raw);
    }
  }
  return headers;
}

function getDocumentName(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const candidate = (value as Record<string, unknown>).documentName;
  return typeof candidate === "string" ? candidate : "";
}

function estimatePayloadSizeBytes(value: unknown): number {
  if (!value || typeof value !== "object") return 0;
  const record = value as Record<string, unknown>;
  const update = record.update;
  if (update instanceof Uint8Array) return update.byteLength;
  const state = record.state;
  if (state instanceof Uint8Array) return state.byteLength;
  const document = record.document as { toJSON?: () => unknown } | undefined;
  if (document?.toJSON) {
    const json = JSON.stringify(document.toJSON());
    return Buffer.byteLength(json, "utf8");
  }
  return 0;
}

if (
  process.env.NODE_ENV === "production" &&
  process.env.NEXT_PUBLIC_HOCUS_URL?.startsWith("ws://")
) {
  throw new Error("Production requires wss:// for NEXT_PUBLIC_HOCUS_URL");
}

const guardrails = createWsGuardrails();
const metadataDb = createMetadataDb(getSqliteDbPath());

await bootstrapMetadataTable(metadataDb);

const server = new Server({
  extensions: buildHocusServerExtensions(getSqliteDbPath()),
  async onConnect(data) {
    const headers = headersFromUnknown(
      (data as Record<string, unknown>).requestHeaders,
    );
    const ip = getClientIpFromHeaders(headers);
    const decision = guardrails.onConnect(ip);
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
  },
  async onDisconnect(data) {
    const headers = headersFromUnknown(
      (data as Record<string, unknown>).requestHeaders,
    );
    const ip = getClientIpFromHeaders(headers);
    guardrails.onDisconnect(ip);
  },
  async onLoadDocument(data) {
    const name = getDocumentName(data);
    if (!isValidWsDocumentName(name)) {
      throw new Error("invalid_document_name");
    }

    if (isSystemDocumentId(name)) return;

    const exists = await documentExists(metadataDb, name);
    if (!exists) {
      const headers = headersFromUnknown(
        (data as Record<string, unknown>).requestHeaders,
      );
      const ip = getClientIpFromHeaders(headers);
      const total = await countNonSystemDocuments(metadataDb);
      const decision = guardrails.canCreateDocument(ip, total);
      if (!decision.allowed) {
        throw new Error(decision.reason);
      }
    }
  },
  async onStoreDocument(data) {
    const name = getDocumentName(data);
    const sizeBytes = estimatePayloadSizeBytes(data);
    const decision = guardrails.canStoreDocument(name, sizeBytes);
    if (!decision.allowed) {
      throw new Error(decision.reason);
    }
    if (!isSystemDocumentId(name)) {
      await upsertDocumentActivity(metadataDb, name, sizeBytes);
    }
  },
});

server.listen(getPort());

process.on("SIGTERM", () => {
  metadataDb.close();
  process.exit(0);
});

process.on("SIGINT", () => {
  metadataDb.close();
  process.exit(0);
});
