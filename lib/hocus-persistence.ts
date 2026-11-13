import type { Database as SqliteDatabase } from "bun:sqlite";

import { SkipFurtherHooksError } from "@hocuspocus/common";
import { Database } from "@hocuspocus/extension-database";

import type { GuardrailDecision } from "@/lib/security/ws-guardrails";

/**
 * Same table as `@hocuspocus/extension-sqlite` (v3 and v4), so existing
 * `db.sqlite` files load unchanged.
 */
export const DOCUMENTS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS "documents" (
    "name" varchar(255) NOT NULL,
    "data" blob NOT NULL,
    UNIQUE(name)
  )
`;

type SqlitePersistenceOptions = {
  /** Checked before every write with the encoded Yjs state size. */
  canStore: (documentName: string, sizeBytes: number) => GuardrailDecision;
  /** Runs after the state has been written. */
  onStored: (documentName: string, sizeBytes: number) => void;
};

/**
 * Hocuspocus fetch/store persistence on a caller-owned SQLite handle.
 *
 * A denied store throws `SkipFurtherHooksError`: Hocuspocus v4 keeps a
 * document in memory after any other `onStoreDocument` error (to avoid data
 * loss), which would pin rejected documents in RAM. The skip error ends the
 * hook chain and lets the document unload once its last client leaves.
 */
export function createSqlitePersistence(
  db: SqliteDatabase,
  { canStore, onStored }: SqlitePersistenceOptions,
): Database {
  db.exec(DOCUMENTS_SCHEMA);
  const selectState = db.prepare<{ data: Uint8Array }, [string]>(
    'SELECT data FROM "documents" WHERE name = ?',
  );
  const upsertState = db.prepare(`
    INSERT INTO "documents" ("name", "data") VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET data = excluded.data
  `);

  return new Database({
    async fetch({ documentName }) {
      return selectState.get(documentName)?.data ?? null;
    },
    async store({ documentName, state }) {
      const decision = canStore(documentName, state.byteLength);
      if (!decision.allowed) {
        throw new SkipFurtherHooksError(decision.reason);
      }
      upsertState.run(documentName, state);
      onStored(documentName, state.byteLength);
    },
  });
}
