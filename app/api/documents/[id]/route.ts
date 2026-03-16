import path from "node:path";
import Database from "better-sqlite3";
import { NextResponse } from "next/server";
import { PLAYGROUND_ID } from "@/lib/constants";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ID_LENGTH = 64;

function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

function isValidDocumentId(id: string): boolean {
  if (!id || id.length > MAX_ID_LENGTH) return false;
  if (hasControlChars(id)) return false;
  if (id.includes("../") || id.includes("..\\")) return false;
  return UUID_REGEX.test(id);
}

function getDbPath(): string {
  return process.env.DB_PATH ?? path.join(process.cwd(), "db.sqlite");
}

function openDb(): Database.Database {
  const dbPath = getDbPath();
  const db = new Database(dbPath, { timeout: 5000 });
  db.pragma("journal_mode = WAL");
  return db;
}

const SQLITE_BUSY = 5;
const MAX_RETRIES = 3;

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
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (id === PLAYGROUND_ID) {
    return NextResponse.json(
      { error: "Cannot delete playground document" },
      { status: 400 },
    );
  }

  if (!isValidDocumentId(id)) {
    return NextResponse.json({ error: "Invalid document id" }, { status: 400 });
  }

  try {
    const db = openDb();
    try {
      const deleted = deleteWithRetry(db, id);
      return NextResponse.json({ deleted }, { status: deleted ? 200 : 404 });
    } finally {
      db.close();
    }
  } catch (err) {
    console.error("[DELETE /api/documents]", err);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 },
    );
  }
}
