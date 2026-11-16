import type { Database } from "bun:sqlite";

import { logAbuseEvent } from "../lib/security/abuse-log";
import {
  bootstrapDocumentActivityTable,
  deleteDocumentPermanently,
} from "../lib/security/activity-store";
import {
  isSystemDocumentId,
  isValidUserDocumentId,
} from "../lib/security/doc-id-validator";
import { openSqlite } from "../lib/sqlite-open";

/**
 * Operator takedown: deletes one document and tombstones its name at once.
 * Closing a tab is restorable by anyone for `CLOSED_RETENTION_DAYS`, so it
 * never takes content down.
 *
 *   DB_PATH=/path/to/db.sqlite bun run scripts/delete-document.ts <id>
 */
export function runDeleteDocument(
  db: Database,
  id: string,
): "deleted" | "missing" | "invalid" {
  if (!isValidUserDocumentId(id) || isSystemDocumentId(id)) return "invalid";
  bootstrapDocumentActivityTable(db);
  return deleteDocumentPermanently(db, id) ? "deleted" : "missing";
}

function runCli(): void {
  const id = process.argv[2] ?? "";
  const db = openSqlite({ busyTimeoutMs: 10_000 });
  try {
    const result = runDeleteDocument(db, id);
    if (result === "invalid") {
      console.error(`Invalid document id: ${JSON.stringify(id)}`);
      process.exitCode = 2;
      return;
    }
    logAbuseEvent("document_deleted_by_operator", {
      id,
      existed: result === "deleted",
    });
  } finally {
    db.close();
  }
}

if (import.meta.main) {
  runCli();
}
