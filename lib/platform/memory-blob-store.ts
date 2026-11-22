/**
 * `MemoryBlobStore`: a `BlobStore` in memory, for tests and the desktop dev
 * bridge. It keeps the same `blobs` and `doc_blobs` rows as the desktop
 * worker and the web library (format 2, offline revision §3.2), with the
 * same snake_case names and keys:
 * - `doc_blobs` is keyed `(doc_id, hash, kind)`, and `hash` references
 *   `blobs` ON DELETE RESTRICT: no row ever names a blob that isn't stored.
 * - `put` snapshots the bytes first, then checks, hashes and stores that
 *   copy: a caller's hash is never trusted, as in the worker.
 * - `recount` only sets `dropped_at` and never touches `version` rows; `gc`
 *   is the only delete and respects the 30-day grace.
 */
import type { AssetHex } from "@/lib/assets/asset-ref";
import { sha256Hex } from "@/lib/assets/hash";
import { type AssetMime, MAX_ASSET_BYTES } from "@/lib/assets/limits";
import { checkImageBytes } from "@/lib/assets/sniff";
import {
  ASSET_GC_GRACE_MS,
  type BlobOrigin,
  type BlobStore,
  BlobStoreError,
  type DocBlobKind,
} from "@/lib/platform/blob-store";

/** A `blobs` row (format 2, snake_case as on desktop and the web), plus the bytes. */
type BlobRow = {
  hash: AssetHex;
  mime: AssetMime;
  size: number;
  width: number;
  height: number;
  created_at: number;
  origin: BlobOrigin;
};

type StoredBlob = BlobRow & { bytes: Uint8Array };

/** A `doc_blobs` row; its key is `(doc_id, hash, kind)`. */
export type DocBlobRow = {
  doc_id: string;
  hash: AssetHex;
  kind: DocBlobKind;
  dropped_at: number | null;
};

const rowKey = (docId: string, hash: AssetHex, kind: DocBlobKind) =>
  `${docId}\u0000${hash}\u0000${kind}`;

export type MemoryBlobStoreOptions = {
  /** Store time for `created_at` and `dropped_at`. Default `Date.now`. */
  now?: () => number;
  /** Default 30 days. */
  graceMs?: number;
  /** Makes `url` synchronous for present blobs, like desktop. Default: always `null`, like the web. */
  syncUrl?: (hex: AssetHex) => string;
};

export class MemoryBlobStore implements BlobStore {
  private readonly blobs = new Map<AssetHex, StoredBlob>();
  /** `doc_blobs`, by `rowKey(doc_id, hash, kind)`. */
  private readonly docBlobs = new Map<string, DocBlobRow>();
  private readonly missing = new Set<AssetHex>();
  private nextError: Error | null = null;
  private readonly now: () => number;
  private readonly graceMs: number;
  private readonly syncUrl?: (hex: AssetHex) => string;

  constructor(options: MemoryBlobStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.graceMs = options.graceMs ?? ASSET_GC_GRACE_MS;
    this.syncUrl = options.syncUrl;
  }

  /** Test switch: the next `put` rejects with `error`, storing nothing. */
  failNext(error: Error = new BlobStoreError("io_error")): void {
    this.nextError = error;
  }

  /** Test switch: the bytes vanish (external damage); rows stay. */
  markMissing(hex: AssetHex): void {
    this.missing.add(hex);
  }

  /** Test switch: a `version` row, as a Live version save (P4.8) adds. */
  addVersionRef(docId: string, hex: AssetHex): void {
    this.upsert(docId, hex, "version");
  }

  /** The `doc_blobs` rows of `docId`, for assertions. */
  rows(docId: string): Readonly<DocBlobRow>[] {
    return [...this.docBlobs.values()].filter((row) => row.doc_id === docId);
  }

  /** INSERT … ON CONFLICT DO UPDATE SET dropped_at = NULL; RESTRICT on an unknown hash. */
  private upsert(docId: string, hash: AssetHex, kind: DocBlobKind): void {
    if (!this.blobs.has(hash))
      throw new BlobStoreError("io_error", "FOREIGN KEY");
    const key = rowKey(docId, hash, kind);
    const row = this.docBlobs.get(key);
    if (row) row.dropped_at = null;
    else
      this.docBlobs.set(key, { doc_id: docId, hash, kind, dropped_at: null });
  }

  private present(hex: AssetHex): boolean {
    return this.blobs.has(hex) && !this.missing.has(hex);
  }

  async put(
    docId: string,
    bytes: Uint8Array,
    mime: AssetMime,
    origin: BlobOrigin = "insert",
  ): Promise<{ hex: AssetHex }> {
    if (this.nextError) {
      const error = this.nextError;
      this.nextError = null;
      throw error;
    }
    // Snapshot first: the caller may reuse its buffer while we hash.
    const copy = bytes.slice();
    if (copy.byteLength > MAX_ASSET_BYTES) {
      throw new BlobStoreError("too_large");
    }
    const check = checkImageBytes(copy, mime);
    if (!check.ok) {
      throw new BlobStoreError(
        check.reason === "too_many_pixels" ? "too_large" : "invalid_image",
        check.reason,
      );
    }
    const hex = await sha256Hex(copy);
    if (!this.blobs.has(hex) || this.missing.has(hex)) {
      this.missing.delete(hex);
      this.blobs.set(hex, {
        hash: hex,
        bytes: copy,
        mime: check.mime,
        size: copy.byteLength,
        width: check.width,
        height: check.height,
        created_at: this.now(),
        origin,
      });
    }
    this.upsert(docId, hex, "provisional");
    return { hex };
  }

  url(hex: AssetHex): string | null {
    return this.syncUrl && this.present(hex) ? this.syncUrl(hex) : null;
  }

  async get(hex: AssetHex): Promise<Blob | null> {
    const blob = this.present(hex) ? this.blobs.get(hex) : undefined;
    return blob
      ? new Blob([blob.bytes as Uint8Array<ArrayBuffer>], { type: blob.mime })
      : null;
  }

  async has(hexes: readonly AssetHex[]): Promise<AssetHex[]> {
    return hexes.filter((hex) => this.present(hex));
  }

  async recount(docId: string, hexes: readonly AssetHex[]): Promise<void> {
    const now = this.now();
    // A hash with no `blobs` row has no bytes to keep, and RESTRICT forbids
    // a row for it: skipped. Its row is added when its bytes arrive (`put`).
    const keep = new Set(hexes.filter((hex) => this.blobs.has(hex)));
    for (const row of this.docBlobs.values()) {
      if (row.doc_id !== docId || row.kind === "version") continue;
      const kept = row.kind === "current" && keep.has(row.hash);
      if (!kept && row.dropped_at === null) row.dropped_at = now;
    }
    for (const hex of keep) this.upsert(docId, hex, "current");
  }

  async gc(now: number): Promise<{ deleted: number; bytes: number }> {
    let deleted = 0;
    let bytes = 0;
    for (const [hex, blob] of this.blobs) {
      const rows = [...this.docBlobs.values()].filter(
        (row) => row.hash === hex,
      );
      const collectable =
        rows.length === 0
          ? now - blob.created_at >= this.graceMs
          : rows.every(
              (row) =>
                row.dropped_at !== null && now - row.dropped_at >= this.graceMs,
            );
      if (!collectable) continue;
      // Rows first, then the blob (RESTRICT).
      for (const [key, row] of this.docBlobs) {
        if (row.hash === hex) this.docBlobs.delete(key);
      }
      this.blobs.delete(hex);
      this.missing.delete(hex);
      deleted += 1;
      bytes += blob.size;
    }
    return { deleted, bytes };
  }
}
