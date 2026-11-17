/**
 * Storage error codes (desktop architecture §9). The engine rejects with a
 * {@link StorageError}; the worker sends `{ code, retryable }` across, never
 * a thrown object. This list must stay a superset of `DOC_STORE_ERROR_CODES`
 * in `lib/platform/doc-store.ts` minus the web library's `quota_exceeded`
 * (a unit test compares them): the engine cannot import `lib/`.
 */
export const STORAGE_ERROR_CODES = [
  "invalid_argument",
  "forbidden",
  "not_found",
  "already_open",
  "document_open",
  "library_read_only",
  "library_too_new",
  "migration_failed",
  "disk_full",
  "io_error",
  "corrupt",
  "locked_elsewhere",
  "cloud_folder",
  "worker_restarting",
  "library_unavailable",
  "import_too_large",
  "unknown_schema",
] as const;

export type StorageErrorCode = (typeof STORAGE_ERROR_CODES)[number];

const RETRYABLE: ReadonlySet<StorageErrorCode> = new Set([
  "disk_full",
  "io_error",
  "worker_restarting",
  "library_unavailable",
]);

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly retryable: boolean;

  constructor(code: StorageErrorCode, message: string = code) {
    super(message);
    this.name = "StorageError";
    this.code = code;
    this.retryable = RETRYABLE.has(code);
  }
}

/** What crosses the worker boundary in place of a thrown error. */
export type StorageErrorEnvelope = {
  code: StorageErrorCode;
  retryable: boolean;
  message: string;
};

export function toEnvelope(error: unknown): StorageErrorEnvelope {
  const storage =
    error instanceof StorageError
      ? error
      : new StorageError("io_error", String(error));
  return {
    code: storage.code,
    retryable: storage.retryable,
    message: storage.message,
  };
}
