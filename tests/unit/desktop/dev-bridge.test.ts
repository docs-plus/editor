/**
 * The desktop dev bridge (architecture §11, P2.4b): the wire codec, and the
 * renderer's `connectDevBridge` against a real `startStorageHost` over a
 * loopback socket, backed by `MemoryDocLibrary`.
 */
import { afterEach, describe, expect, it } from "bun:test";

import * as Y from "yjs";

import {
  type DevBridgeBackend,
  memoryBackend,
  type StorageHost,
  startStorageHost,
} from "@/desktop/dev/storage-host";
import {
  connectDevBridge,
  type DevBridge,
} from "@/lib/platform/desktop/dev-bridge";
import {
  DEV_BRIDGE_MAX_FRAME_BYTES,
  DEV_BRIDGE_PROTOCOL,
  decodeFrame,
  encodeFrame,
} from "@/lib/platform/desktop/dev-bridge-wire";
import type { LoadedDoc } from "@/lib/platform/doc-store";
import { MemoryDocLibrary } from "@/lib/platform/memory-doc-store";
import { spawnStorageHost } from "@/tests/helpers/spawn-storage-host";

const ORIGIN = "http://localhost:3926";
const DOC = "11111111-1111-4111-8111-111111111111";

/** Bun's WebSocket sends no Origin; a browser always does. */
const BrowserSocket = class extends WebSocket {
  constructor(url: string | URL, protocols?: string | string[]) {
    super(url, { protocols, headers: { Origin: ORIGIN } } as never);
  }
};

const hosts: StorageHost[] = [];
const bridges: DevBridge[] = [];
const RealWebSocket = globalThis.WebSocket;

function host(backend?: DevBridgeBackend): StorageHost {
  const started = startStorageHost({ origins: [ORIGIN], backend });
  hosts.push(started);
  return started;
}

function bridge(of: StorageHost): DevBridge {
  globalThis.WebSocket = BrowserSocket as typeof WebSocket;
  try {
    const connected = connectDevBridge({ url: of.url, token: of.token });
    bridges.push(connected);
    return connected;
  } finally {
    globalThis.WebSocket = RealWebSocket;
  }
}

function update(text: string): Uint8Array {
  const doc = new Y.Doc();
  doc.getText("t").insert(0, text);
  return Y.encodeStateAsUpdate(doc);
}

function textOf(loaded: LoadedDoc): string {
  const doc = new Y.Doc();
  if (loaded.snapshot) Y.applyUpdate(doc, loaded.snapshot);
  for (const u of loaded.updates) Y.applyUpdate(doc, u);
  return doc.getText("t").toString();
}

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return error as { code?: string; message: string };
  }
  throw new Error("expected a rejection");
}

const waitForClose = () => new Promise((resolve) => setTimeout(resolve, 50));

afterEach(() => {
  for (const b of bridges.splice(0)) b.close();
  for (const h of hosts.splice(0)) h.stop();
});

describe("dev bridge wire", () => {
  it("round-trips bytes anywhere in the message", () => {
    const big = new Uint8Array(1024 * 1024).map((_, i) => i % 251);
    const message = {
      id: 7,
      result: {
        ok: true as const,
        value: {
          snapshot: null,
          updates: [new Uint8Array(), big, new Uint8Array([1, 2, 3])],
          maxSeq: 3,
          schema: 0,
        },
      },
    };
    const decoded = decodeFrame(encodeFrame(message)) as typeof message;
    expect(decoded.result.value.snapshot).toBeNull();
    expect(decoded.result.value.updates).toEqual(message.result.value.updates);
    expect(decoded.result.value.updates[1]).toBeInstanceOf(Uint8Array);
  });

  it("keeps Buffers as bytes both ways (the host's frames are Buffers)", () => {
    const frame = encodeFrame({
      id: 2,
      op: "compact",
      args: { state: Buffer.from([1, 2, 3]), upToSeq: 1 },
    });
    const decoded = decodeFrame(Buffer.from(frame)) as {
      args: { state: Uint8Array };
    };
    expect(decoded.args.state).toEqual(new Uint8Array([1, 2, 3]));
    expect(Buffer.isBuffer(decoded.args.state)).toBe(false);
    // Re-encoding a decoded value keeps it as bytes.
    const again = decodeFrame(encodeFrame(decoded as never)) as typeof decoded;
    expect(again.args.state).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("refuses frames over the cap and truncated frames", () => {
    expect(() =>
      encodeFrame({
        id: 1,
        op: "append",
        args: { update: new Uint8Array(DEV_BRIDGE_MAX_FRAME_BYTES) },
      }),
    ).toThrow(RangeError);
    const frame = encodeFrame({
      id: 1,
      op: "load",
      args: { b: new Uint8Array([1, 2, 3, 4]) },
    });
    expect(() => decodeFrame(frame.slice(0, frame.length - 2))).toThrow(
      RangeError,
    );
    expect(() => decodeFrame(frame.slice(0, 6))).toThrow(RangeError);
  });
});

describe("dev storage host", () => {
  it("refuses a wrong token, a wrong origin and a missing protocol", async () => {
    const h = host();
    const http = h.url.replace("ws:", "http:");
    const upgrade = (headers: Record<string, string>) =>
      fetch(http, {
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          ...headers,
        },
      }).then((r) => r.status);

    expect(
      await upgrade({
        Origin: ORIGIN,
        "Sec-WebSocket-Protocol": `${DEV_BRIDGE_PROTOCOL}.wrong`,
      }),
    ).toBe(403);
    expect(
      await upgrade({
        Origin: "http://evil.test",
        "Sec-WebSocket-Protocol": `${DEV_BRIDGE_PROTOCOL}.${h.token}`,
      }),
    ).toBe(403);
    expect(await upgrade({ Origin: ORIGIN })).toBe(403);
  });

  it("never starts in production", () => {
    const env = process.env.NODE_ENV;
    Object.assign(process.env, { NODE_ENV: "production" });
    try {
      expect(() => startStorageHost({ origins: [ORIGIN] })).toThrow(
        /never runs in production/,
      );
    } finally {
      Object.assign(process.env, { NODE_ENV: env });
    }
  });

  it("creates, loads, appends, compacts and reloads a document", async () => {
    const h = host();
    const a = bridge(h);
    await a.call("create", { docId: DOC });
    const first = (await a.call("load", { docId: DOC })) as LoadedDoc;
    expect(first).toEqual({
      snapshot: null,
      updates: [],
      maxSeq: 0,
      schema: 0,
    });

    const seq = await a.call("append", {
      docId: DOC,
      record: { origin: "local", update: update("hello"), title: "Hello" },
    });
    expect(seq).toBe(1);
    await a.call("flush", {});
    await a.call("compact", {
      docId: DOC,
      state: update("hello"),
      upToSeq: 1,
    });
    await a.call("close", { docId: DOC });

    const b = bridge(h);
    const again = (await b.call("load", { docId: DOC })) as LoadedDoc;
    expect(again.updates).toEqual([]);
    expect(textOf(again)).toBe("hello");
  });

  it("holds a document for one connection and releases it when that connection closes", async () => {
    const h = host();
    const a = bridge(h);
    const b = bridge(h);
    await a.call("create", { docId: DOC });
    await a.call("load", { docId: DOC });

    expect((await rejection(b.call("load", { docId: DOC }))).code).toBe(
      "already_open",
    );
    expect(
      (
        await rejection(
          b.call("append", {
            docId: DOC,
            record: { origin: "local", update: update("x") },
          }),
        )
      ).code,
    ).toBe("forbidden");

    a.close();
    await waitForClose();
    expect(textOf((await b.call("load", { docId: DOC })) as LoadedDoc)).toBe(
      "",
    );
  });

  it("refuses malformed requests with bad_request", async () => {
    const h = host();
    // What a buggy or hostile renderer could send, past the types.
    const untyped = bridge(h).call as (
      op: string,
      args: unknown,
    ) => Promise<unknown>;
    for (const [op, args] of [
      ["create", { docId: DOC, schema: -1 }],
      ["load", { docId: "../x" }],
      ["load", {}],
      [
        "append",
        { docId: DOC, record: { origin: "evil", update: update("x") } },
      ],
      ["append", { docId: DOC, record: { origin: "local", update: [1, 2] } }],
      ["compact", { docId: DOC, state: update("x"), upToSeq: -1 }],
    ] as const) {
      expect((await rejection(untyped(op, args))).code).toBe("bad_request");
    }
  });

  it("rejects pending calls without a code when the socket closes", async () => {
    const library = new MemoryDocLibrary();
    const memory = memoryBackend(library);
    const stalled: DevBridgeBackend = {
      connect() {
        const client = memory.connect();
        return { ...client, load: () => new Promise(() => undefined) };
      },
    };
    const h = host(stalled);
    const a = bridge(h);
    await a.call("create", { docId: DOC });
    const pending = a.call("load", { docId: DOC });
    h.stop();

    const error = await rejection(pending);
    expect(error.code).toBeUndefined();
    expect((await rejection(a.call("flush", {}))).code).toBeUndefined();
  });

  it("runs a connection's requests in order", async () => {
    const h = host();
    const a = bridge(h);
    await a.call("create", { docId: DOC });
    await a.call("load", { docId: DOC });
    const seqs = await Promise.all(
      ["a", "b", "c", "d"].map((text) =>
        a.call("append", {
          docId: DOC,
          record: { origin: "local", update: update(text) },
        }),
      ),
    );
    expect(seqs).toEqual([1, 2, 3, 4]);
  });
});

describe("bun desktop/dev/storage-host.ts", () => {
  it("prints its url and token, serves the bridge, and exits when its pipe closes", async () => {
    const spawned = await spawnStorageHost({ origin: ORIGIN });
    expect(spawned.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+$/);
    expect(spawned.token).toMatch(/^[0-9a-f]{64}$/);

    const a = bridge({ ...spawned, stop: () => undefined });
    await a.call("create", { docId: DOC });
    await a.call("load", { docId: DOC });
    await a.call("append", {
      docId: DOC,
      record: { origin: "local", update: update("persisted") },
    });
    await a.call("close", { docId: DOC });
    const b = bridge({ ...spawned, stop: () => undefined });
    expect(textOf((await b.call("load", { docId: DOC })) as LoadedDoc)).toBe(
      "persisted",
    );

    await spawned.stop();
    expect((await rejection(b.call("flush", {}))).code).toBeUndefined();
  });
});
