/**
 * The renderer end of the desktop dev bridge (architecture §11, P2.4b): a
 * request/reply `call` to `desktop/dev/storage-host.ts` over a loopback
 * WebSocket, for a desktop-target `next dev` (NEXT_PUBLIC_DESKTOP_BRIDGE=dev)
 * and the `local` Playwright project. Never in a release build: load it
 * only through `import()` inside a literal
 * `process.env.NEXT_PUBLIC_DESKTOP_BRIDGE === "dev"` branch.
 *
 * `call(op, args)` has P2.6's `DocStoreCall` shape, so
 * `createRpcDocStore(call)` makes the `DocStore` (#125); `create` is the dev
 * stand-in for `DocumentIndex.create`.
 *
 * - A reply's `{ code }` rejects as `{ code, message }`, which
 *   `toDocStoreError` keeps (`already_open`, `forbidden`…).
 * - When the socket closes, every pending and later call rejects without a
 *   code, which becomes the retryable `library_unavailable`. There is no
 *   reconnect: the host released this connection's documents, and claiming
 *   them again is main's registry replay (P2.5), not the dev bridge's.
 */
import {
  DEV_BRIDGE_MARKER,
  DEV_BRIDGE_PROTOCOL,
  type DevBridgeReply,
  decodeFrame,
  encodeFrame,
} from "@/lib/platform/desktop/dev-bridge-wire";
import type { DocStoreCalls } from "@/lib/platform/desktop/rpc-doc-store";

/** P2.6's calls, plus `create` (the dev stand-in for `DocumentIndex.create`). */
export type DevBridgeCalls = DocStoreCalls & {
  create: [{ docId: string; schema?: number }, null];
};

/** Assignable to `DocStoreCall`, so `createRpcDocStore(bridge.call)` works. */
export type DevBridgeCall = <K extends keyof DevBridgeCalls>(
  op: K,
  args: DevBridgeCalls[K][0],
) => Promise<DevBridgeCalls[K][1]>;

export type DevBridgeOptions = {
  /** `ws://127.0.0.1:<port>` from the host's first line. */
  url: string;
  token: string;
};

export type DevBridge = { call: DevBridgeCall; close(): void };

type Pending = {
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

class BridgeError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

export function connectDevBridge(options: DevBridgeOptions): DevBridge {
  const socket = new WebSocket(options.url, [
    `${DEV_BRIDGE_PROTOCOL}.${options.token}`,
  ]);
  socket.binaryType = "arraybuffer";
  const opened = new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener(
      "close",
      () => reject(new BridgeError(`${DEV_BRIDGE_MARKER}: closed`)),
      { once: true },
    );
  });
  opened.catch(() => undefined);

  const pending = new Map<number, Pending>();
  let nextId = 1;
  let closed = false;

  socket.addEventListener("message", (event) => {
    if (!(event.data instanceof ArrayBuffer)) return;
    let reply: DevBridgeReply;
    try {
      reply = decodeFrame(event.data) as DevBridgeReply;
    } catch {
      return;
    }
    const waiter = pending.get(reply.id);
    if (!waiter) return;
    pending.delete(reply.id);
    if (reply.result.ok) waiter.resolve(reply.result.value);
    else {
      const { code, message } = reply.result.error;
      waiter.reject(new BridgeError(message, code));
    }
  });

  socket.addEventListener("close", () => {
    closed = true;
    const error = new BridgeError(`${DEV_BRIDGE_MARKER}: closed`);
    for (const waiter of pending.values()) waiter.reject(error);
    pending.clear();
  });

  const call = async (op: string, args: unknown): Promise<unknown> => {
    await opened;
    if (closed) throw new BridgeError(`${DEV_BRIDGE_MARKER}: closed`);
    const id = nextId++;
    const frame = encodeFrame({ id, op, args } as never);
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(frame);
    });
  };
  return { call: call as DevBridgeCall, close: () => socket.close() };
}
