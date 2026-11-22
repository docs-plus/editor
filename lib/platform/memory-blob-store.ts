/**
 * `MemoryBlobStore`: a `BlobStore` in memory, for tests and the desktop dev
 * bridge. It keeps the same `blobs` and `doc_blobs` rows as the desktop
 * worker and the web library (format 2, offline revision §3.2), with the
 * same snake_case names, and never trusts a caller's hash: `put` recomputes
 * it, as the worker does. `recount` never deletes a row, and `gc` respects
 * the 30-day grace.
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

/** A `doc_blobs` row, keyed by `doc_id` and `hash` in the maps below. */
type DocBlobRow = { kind: DocBlobKind; dropped_at: number | null };

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
  /** `docId` → `hex` → row. */
  private readonly docBlobs = new Map<string, Map<AssetHex, DocBlobRow>>();
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

  /** The `doc_blobs` rows of `docId`, for assertions. */
  rows(docId: string): ReadonlyMap<AssetHex, Readonly<DocBlobRow>> {
    return this.docBlobs.get(docId) ?? new Map();
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
    if (bytes.byteLength > MAX_ASSET_BYTES) {
      throw new BlobStoreError("too_large");
    }
    const check = checkImageBytes(bytes, mime);
    if (!check.ok) {
      throw new BlobStoreError(
        check.reason === "too_many_pixels" ? "too_large" : "invalid_image",
        check.reason,
      );
    }
    const hex = await sha256Hex(bytes);
    if (!this.blobs.has(hex) || this.missing.has(hex)) {
      this.missing.delete(hex);
      this.blobs.set(hex, {
        hash: hex,
        bytes: bytes.slice(),
        mime: check.mime,
        size: bytes.byteLength,
        width: check.width,
        height: check.height,
        created_at: this.now(),
        origin,
      });
    }
    const rows = this.docBlobs.get(docId) ?? new Map<AssetHex, DocBlobRow>();
    this.docBlobs.set(docId, rows);
    const row = rows.get(hex);
    if (row) row.dropped_at = null;
    else rows.set(hex, { kind: "provisional", dropped_at: null });
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
    const keep = new Set(hexes);
    const rows = this.docBlobs.get(docId) ?? new Map<AssetHex, DocBlobRow>();
    this.docBlobs.set(docId, rows);
    for (const [hex, row] of rows) {
      if (!keep.has(hex) && row.dropped_at === null) row.dropped_at = now;
    }
    for (const hex of keep)
      rows.set(hex, { kind: "current", dropped_at: null });
  }

  async gc(now: number): Promise<{ deleted: number; bytes: number }> {
    let deleted = 0;
    let bytes = 0;
    for (const [hex, blob] of this.blobs) {
      const rows = [...this.docBlobs.values()]
        .map((docRows) => docRows.get(hex))
        .filter((row) => row !== undefined);
      const collectable =
        rows.length === 0
          ? now - blob.created_at >= this.graceMs
          : rows.every(
              (row) =>
                row.dropped_at !== null && now - row.dropped_at >= this.graceMs,
            );
      if (!collectable) continue;
      this.blobs.delete(hex);
      this.missing.delete(hex);
      for (const docRows of this.docBlobs.values()) docRows.delete(hex);
      deleted += 1;
      bytes += blob.size;
    }
    return { deleted, bytes };
  }
}
