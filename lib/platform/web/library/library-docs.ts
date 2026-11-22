/**
 * The one index write W2 needs: creating a document's `docs` row, as
 * `DocumentIndex.create` will (desktop `library-index.ts` `createDoc`).
 * `IdbDocumentIndex` takes it over with the rest of the index operations.
 */
import { DocStoreError } from "@/lib/platform/doc-store";

import type { LibraryDb } from "./library-db";
import {
  type DocRow,
  listKey,
  META_KEYS,
  type MetaRow,
  STORES,
} from "./library-schema";

export type CreateLibraryDocInput = {
  id?: string;
  title?: string;
  folderId?: string | null;
  sortKey?: string;
  schema?: number;
  lineage?: string;
  linkKey?: string;
  kind?: "doc" | "template";
};

export type CreatedLibraryDoc = {
  id: string;
  lineage: string;
  linkKey: string;
};

/** A new `link_key`: 32 lowercase hex characters (seam S16). */
export function mintLinkKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Bumps `meta.rev`, the index change counter, inside `tx` (which must cover
 * `meta`). Issued synchronously with the write it counts.
 */
export function bumpRev(tx: IDBTransaction): void {
  const meta = tx.objectStore(STORES.meta);
  const request = meta.get(META_KEYS.rev);
  request.onsuccess = () => {
    const current = (request.result as MetaRow | undefined)?.value;
    meta.put({
      key: META_KEYS.rev,
      value: (typeof current === "number" ? current : 0) + 1,
    });
  };
}

export function createLibraryDoc(
  library: LibraryDb,
  input: CreateLibraryDocInput = {},
  now: number = Date.now(),
): Promise<CreatedLibraryDoc> {
  try {
    library.assertWritable();
  } catch (error) {
    return Promise.reject(error);
  }
  const schema = input.schema ?? 0;
  if (!Number.isInteger(schema) || schema < 0) {
    return Promise.reject(new DocStoreError("invalid_argument", "bad schema"));
  }
  const folderId = input.folderId ?? null;
  const row: DocRow = {
    id: input.id ?? crypto.randomUUID(),
    title: input.title ?? "",
    folder_id: folderId,
    sort_key: input.sortKey ?? "",
    pin_key: null,
    pinned: false,
    created_at: now,
    modified_at: now,
    opened_at: null,
    trashed_at: null,
    trash_group: null,
    trashed_from: null,
    schema,
    lineage: input.lineage ?? crypto.randomUUID(),
    size_bytes: 0,
    snippet: "",
    exported_at: null,
    md_at: null,
    link_key: input.linkKey ?? mintLinkKey(),
    kind: input.kind ?? "doc",
    list_key: listKey(folderId, null),
  };
  return library.run<CreatedLibraryDoc>(
    [STORES.docs, STORES.meta],
    "readwrite",
    "strict",
    (tx, { done }) => {
      // `add`, not `put`: an existing id or link key aborts the transaction.
      tx.objectStore(STORES.docs).add(row);
      bumpRev(tx);
      done({ id: row.id, lineage: row.lineage, linkKey: row.link_key });
    },
  );
}
