/**
 * `IpcDocStore`: the packaged app's `DocStore` (architecture §2, §5.2):
 * `createRpcDocStore` over the preload's `window.tinydocy` bridge (P2.5).
 * Main validates every call, checks the open-document registry and
 * forwards to the storage worker; a refusal comes back as an `IpcResult`
 * whose `code` becomes a `DocStoreError`.
 *
 * `lib/` may import only types from `desktop/` (architecture §3.3), so the
 * op → channel map is repeated here; a unit test keeps it equal to
 * `DOC_STORE_CHANNELS` in `desktop/shared/ipc-contract.ts`.
 */
import type { TinydocyBridge } from "@/desktop/shared/ipc-contract";

import type { DocStore } from "../doc-store";
import { createRpcDocStore, type DocStoreCall } from "./rpc-doc-store";

export const IPC_DOC_STORE_CHANNELS = {
  load: "doc.open",
  append: "doc.append",
  compact: "doc.compact",
  close: "doc.close",
  flush: "doc.flush",
} as const;

/** A refused call: carries main's error code, which `toDocStoreError` maps. */
export class IpcCallError extends Error {
  readonly code: string;
  readonly retryable: boolean;
  constructor(code: string, retryable: boolean) {
    super(`ipc: ${code}`);
    this.name = "IpcCallError";
    this.code = code;
    this.retryable = retryable;
  }
}

export function createIpcDocStore(bridge: TinydocyBridge): DocStore {
  const call: DocStoreCall = async (op, args) => {
    const result = await bridge.invoke(
      IPC_DOC_STORE_CHANNELS[op],
      args as never,
    );
    if (!result.ok)
      throw new IpcCallError(result.error.code, result.error.retryable);
    return result.value as never;
  };
  return createRpcDocStore(call);
}
