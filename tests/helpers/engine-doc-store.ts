/**
 * `DocStore`s over a real storage engine, in-process on `bun:sqlite`: what
 * the shared contract suite runs against on every PR (architecture §11).
 * Each store is one window (`owner`); two stores over one library model two
 * windows, for `already_open`.
 *
 * Requests go through the worker's own `dispatch`, so the in-process path
 * and the Electron worker share every line but the transport. Bytes are
 * copied on the way in, as IPC would.
 */
import type { Library } from "@/desktop/storage/engine/library";
import { dispatch, type StorageRequest } from "@/desktop/storage/protocol";
import {
  createRpcDocStore,
  type DocStoreCall,
} from "@/lib/platform/desktop/rpc-doc-store";
import type { DocStore } from "@/lib/platform/doc-store";

function copyBytes<T>(value: T): T {
  if (value instanceof Uint8Array) return value.slice() as T;
  if (Array.isArray(value)) return value.map(copyBytes) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, copyBytes(v)]),
    ) as T;
  return value;
}

let nextId = 1;

export function createEngineDocStore(
  library: Library,
  owner: string,
): DocStore {
  const call: DocStoreCall = async (op, args) => {
    const request = {
      id: nextId++,
      op,
      args: op === "flush" ? {} : { ...copyBytes(args), owner },
    } as StorageRequest;
    // A microtask boundary, as a real transport has.
    await Promise.resolve();
    const result = dispatch(library, request);
    if (!result.ok) throw result.error;
    return copyBytes(result.value) as never;
  };
  return createRpcDocStore(call);
}
