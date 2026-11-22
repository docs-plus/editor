/**
 * `BlobStore`: the image bytes port (image store spec §3.1, I4, I5). Image
 * nodes hold `asset:sha256-<hex>` refs; the bytes live here, keyed by the
 * SHA-256 of their (stripped) content.
 *
 * Implementations:
 * - desktop: `IpcBlobStore` → main → storage worker, files under
 *   `<userData>/assets/` (P2.6b);
 * - web library: `IdbBlobStore` over IndexedDB (W11);
 * - tests and the dev bridge: `MemoryBlobStore`.
 * Every one passes `tests/helpers/blob-store-contract.ts`.
 *
 * Rules every store keeps:
 * - `put` never trusts the caller: it re-checks the size and magic bytes
 *   against the declared type and recomputes the hash. It resolves only once
 *   the bytes are durable, so a document never references missing bytes.
 * - **GC never deletes a referenced blob** (I10). A blob is collectable only
 *   when every `doc_blobs` row for it was dropped at least
 *   `ASSET_GC_GRACE_MS` ago, or, with no rows at all, it was created that
 *   long ago. A row with `droppedAt === null` (current or provisional)
 *   always keeps the blob.
 *
 * Types only, plus the error class, so the storage worker and the IPC
 * contract can mirror it.
 */
import type { AssetHex } from "@/lib/assets/asset-ref";
import type { AssetMime } from "@/lib/assets/limits";

export type { AssetHex };

/** How a blob first arrived (`blobs.origin`). */
export type BlobOrigin = "insert" | "migration" | "import" | "fetched";

/** `doc_blobs.kind`. `version` rows arrive with Live versions (P4.8). */
export type DocBlobKind = "provisional" | "current";

/** 30 days (`ASSET_GC_GRACE_DAYS`): outlives every copy that can restore a ref (§3.4). */
export const ASSET_GC_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

export interface BlobStore {
  /**
   * Verifies and stores `bytes`, and adds a provisional `doc_blobs` row for
   * `docId` (or clears its `droppedAt`). Storing bytes already present is a
   * dedupe, not an error. Resolves with the recomputed digest once durable.
   */
  put(
    docId: string,
    bytes: Uint8Array,
    mime: AssetMime,
    origin?: BlobOrigin,
  ): Promise<{ hex: AssetHex }>;
  /**
   * A URL for `hex` when it is present and cheap to know synchronously
   * (desktop: `app://tinydocy/_asset/<hex>`), otherwise `null` (always on
   * the web, which renders through the object-URL cache).
   */
  url(hex: AssetHex): string | null;
  /** The bytes, typed with their sniffed type, or `null` when missing. */
  get(hex: AssetHex): Promise<Blob | null>;
  /** Which of `hexes` are present, in the order given. */
  has(hexes: readonly AssetHex[]): Promise<AssetHex[]>;
  /**
   * `hexes` is the FULL set the document's current state references (§3.4).
   * In one transaction: those rows become `current` with `droppedAt = null`;
   * every other current or provisional row of the document gets
   * `droppedAt = now` (if it was null). Permanently deleting a document is
   * `recount(docId, [])`.
   */
  recount(docId: string, hexes: readonly AssetHex[]): Promise<void>;
  /** Deletes collectable blobs (see the module comment). */
  gc(now: number): Promise<{ deleted: number; bytes: number }>;
}

export const BLOB_STORE_ERROR_CODES = [
  /** Not one of the four types, a mismatched type, or an unreadable header. */
  "invalid_image",
  /** Over `MAX_ASSET_BYTES`, or over the pixel limits. */
  "too_large",
  /** Web: the browser's storage quota. */
  "quota_exceeded",
  /** Desktop: the disk is full. */
  "disk_full",
  "io_error",
] as const;

export type BlobStoreErrorCode = (typeof BLOB_STORE_ERROR_CODES)[number];

export class BlobStoreError extends Error {
  readonly code: BlobStoreErrorCode;

  constructor(code: BlobStoreErrorCode, message: string = code) {
    super(message);
    this.name = "BlobStoreError";
    this.code = code;
  }
}
