/**
 * P2.1's DocStore contract through the whole dev-bridge path, as the `local`
 * Playwright project's renderer uses it: `createRpcDocStore` (#125) over
 * `connectDevBridge`, a loopback socket, `startStorageHost` and its
 * `MemoryDocLibrary` backend. Each `connect()` is a new connection, like a
 * new window, so the `exclusiveOpen` cases run.
 */
import { describe, it } from "bun:test";

import { startStorageHost } from "@/desktop/dev/storage-host";
import {
  connectDevBridge,
  type DevBridge,
} from "@/lib/platform/desktop/dev-bridge";
import { createRpcDocStore } from "@/lib/platform/desktop/rpc-doc-store";
import {
  type DocStoreHarness,
  defineDocStoreContract,
} from "@/tests/helpers/doc-store-contract";

const ORIGIN = "http://localhost:3926";

/** Bun's WebSocket sends no Origin; a browser always does. */
const BrowserSocket = class extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, { protocols, headers: { Origin: ORIGIN } } as never);
  }
};

function connect(url: string, token: string): DevBridge {
  const real = globalThis.WebSocket;
  globalThis.WebSocket = BrowserSocket as typeof WebSocket;
  try {
    return connectDevBridge({ url, token });
  } finally {
    globalThis.WebSocket = real;
  }
}

const harness: DocStoreHarness = {
  exclusiveOpen: true,
  async createLibrary() {
    const host = startStorageHost({ origins: [ORIGIN] });
    const bridges: DevBridge[] = [];
    const open = () => {
      const bridge = connect(host.url, host.token);
      bridges.push(bridge);
      return bridge;
    };
    const admin = open();
    return {
      connect: () => createRpcDocStore(open().call),
      createDoc: async (docId, schema) => {
        await admin.call("create", { docId, schema });
      },
      dispose: async () => {
        for (const bridge of bridges) bridge.close();
        host.stop();
      },
    };
  },
};

defineDocStoreContract(
  { describe, it },
  "DocStore contract: the dev bridge over MemoryDocLibrary",
  harness,
);
