/**
 * A `DocStore` over request/reply calls to the storage worker. `IpcDocStore`
 * (P2.5) passes a `call` that goes through `window.tinydocy`; tests and the
 * Electron soak pass one that goes to a `StorageClient` (adding the window's
 * owner id) or dispatches in-process.
 *
 * A rejection that carries a storage `code` becomes a `DocStoreError`;
 * anything else (a dead transport) becomes `library_unavailable`, which is
 * retryable, so the batcher keeps the batch and retries it in order.
 */
import {
  type AppendRecord,
  type CompactResult,
  DOC_STORE_ERROR_CODES,
  type DocStore,
  DocStoreError,
  type DocStoreErrorCode,
  type LoadedDoc,
} from "@/lib/platform/doc-store";

export type DocStoreCalls = {
  load: [{ docId: string }, LoadedDoc];
  append: [{ docId: string; record: AppendRecord }, number];
  compact: [
    { docId: string; state: Uint8Array; upToSeq: number },
    CompactResult,
  ];
  close: [{ docId: string }, null];
  flush: [Record<string, never>, null];
};

export type DocStoreCall = <K extends keyof DocStoreCalls>(
  op: K,
  args: DocStoreCalls[K][0],
) => Promise<DocStoreCalls[K][1]>;

const CODES: ReadonlySet<string> = new Set(DOC_STORE_ERROR_CODES);

export function toDocStoreError(error: unknown): DocStoreError {
  if (error instanceof DocStoreError) return error;
  const code = (error as { code?: unknown } | null)?.code;
  const message = error instanceof Error ? error.message : String(error);
  if (typeof code === "string" && CODES.has(code))
    return new DocStoreError(code as DocStoreErrorCode, message);
  return new DocStoreError("library_unavailable", message);
}

export function createRpcDocStore(call: DocStoreCall): DocStore {
  const wrap = async <T>(run: () => Promise<T>): Promise<T> => {
    try {
      return await run();
    } catch (error) {
      throw toDocStoreError(error);
    }
  };
  return {
    load: (docId) => wrap(() => call("load", { docId })),
    append: (docId, record) => wrap(() => call("append", { docId, record })),
    compact: (docId, state, upToSeq) =>
      wrap(() => call("compact", { docId, state, upToSeq })),
    close: async (docId) => {
      await wrap(() => call("close", { docId }));
    },
    flush: async () => {
      await wrap(() => call("flush", {}));
    },
  };
}
