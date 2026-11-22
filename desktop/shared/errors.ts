/**
 * One error-code union for everything that crosses IPC (desktop
 * architecture §9). Nothing is thrown across IPC: a handler answers with a
 * {@link IpcResult}. The storage family mirrors `STORAGE_ERROR_CODES` in
 * `desktop/storage/engine/errors.ts` (a unit test compares them), because
 * this folder may not import anything outside itself.
 */

export const ERROR_CODES = {
  // Contract
  invalid_argument: { retryable: false },
  forbidden: { retryable: false },
  build_mismatch: { retryable: false },
  // Storage
  not_found: { retryable: false },
  already_open: { retryable: false },
  document_open: { retryable: false },
  library_read_only: { retryable: false },
  library_too_new: { retryable: false },
  migration_failed: { retryable: false },
  disk_full: { retryable: true },
  io_error: { retryable: true },
  corrupt: { retryable: false },
  locked_elsewhere: { retryable: false },
  cloud_folder: { retryable: false },
  worker_restarting: { retryable: true },
  library_unavailable: { retryable: true },
  // Content
  import_too_large: { retryable: false },
  unknown_schema: { retryable: false },
  doc_too_new: { retryable: false },
} as const satisfies Record<string, { retryable: boolean }>;

export type ErrorCode = keyof typeof ERROR_CODES;

export type IpcError = { code: ErrorCode; retryable: boolean };

export type IpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: IpcError };

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.hasOwn(ERROR_CODES, value);
}

export const ok = <T>(value: T): IpcResult<T> => ({ ok: true, value });

export const fail = (code: ErrorCode): { ok: false; error: IpcError } => ({
  ok: false,
  error: { code, retryable: ERROR_CODES[code].retryable },
});
