import { Database } from "bun:sqlite";

import { DOCUMENTS_SCHEMA } from "@/lib/hocus-persistence";
import { bootstrapDocumentActivityTable } from "@/lib/security/activity-store";
import { mintShareId } from "@/lib/sharing/share-name";
import {
  bootstrapSharesTable,
  createShareRow,
} from "@/lib/sharing/share-store";
import { parseShareHash } from "@/lib/sharing/share-token";
import {
  makeShareSecrets,
  type ShareSecrets,
} from "@/tests/helpers/share-secrets";

/** An in-memory database with the tables the Hocus process creates. */
export function createShareDb(): Database {
  const db = new Database(":memory:");
  db.exec(DOCUMENTS_SCHEMA);
  bootstrapDocumentActivityTable(db);
  bootstrapSharesTable(db);
  return db;
}

/** Inserts a pending share made from fresh client secrets. */
export function seedShare(
  db: Database,
  nowMs: number = Date.now(),
): { shareId: string; secrets: ShareSecrets } {
  const secrets = makeShareSecrets();
  const shareId = mintShareId();
  createShareRow(
    db,
    {
      shareId,
      lineage: crypto.randomUUID(),
      editHash: parseShareHash(secrets.hashes.edit_hash) as Buffer,
      viewHash: parseShareHash(secrets.hashes.view_hash) as Buffer,
      ownerHash: parseShareHash(secrets.hashes.owner_hash) as Buffer,
      schema: 3,
      createdIpHash: "ip-hash",
    },
    nowMs,
  );
  return { shareId, secrets };
}
