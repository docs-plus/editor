import path from "node:path";

/** Shared default for Hocuspocus SQLite, Next DELETE handler, and retention purge. */
export function getSqliteDbPath(): string {
  return process.env.DB_PATH ?? path.join(process.cwd(), "db.sqlite");
}
