/**
 * The desktop dev storage host (architecture §11, P2.4b): what main and the
 * storage worker are to the packaged app, for a desktop-target `next dev`
 * and the `local` Playwright project. Dev and test only.
 *
 *   DESKTOP_BRIDGE_ORIGIN=http://localhost:3000 bun desktop/dev/storage-host.ts
 *
 * It prints one JSON line, `{ "url": "ws://127.0.0.1:<port>", "token": … }`,
 * and serves the dev bridge's wire (`lib/platform/desktop/dev-bridge-wire.ts`).
 * - Loopback only, a random token per run (checked at upgrade, in constant
 *   time), the dev server's origin only, refused under NODE_ENV=production.
 * - One client per connection, like one window: a document is held by one
 *   connection at a time (`already_open`), and closing the connection
 *   releases what it held.
 * - The backend is `MemoryDocLibrary` for now, a fresh one per process (so
 *   one host per Playwright worker is one library per worker). P2.6 swaps
 *   in the engine on `bun:sqlite` behind the same `DevBridgeBackend`.
 * - `HOCUS_EXIT_ON_STDIN_EOF`-style: with DESKTOP_BRIDGE_EXIT_ON_STDIN_EOF=1
 *   it exits when its parent's pipe closes.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";

import {
  DEV_BRIDGE_MAX_FRAME_BYTES,
  DEV_BRIDGE_OPS,
  DEV_BRIDGE_PROTOCOL,
  type DevBridgeError,
  type DevBridgeOp,
  type DevBridgeReply,
  decodeFrame,
  encodeFrame,
} from "@/lib/platform/desktop/dev-bridge-wire";
import {
  type AppendRecord,
  DOC_STORE_ERROR_CODES,
  type DocStoreErrorCode,
  isRetryableDocStoreError,
  UPDATE_ORIGINS,
  type UpdateOrigin,
} from "@/lib/platform/doc-store";
import {
  MemoryDocLibrary,
  MemoryDocStore,
} from "@/lib/platform/memory-doc-store";

/** One window's view of the library. */
export type DevBridgeClient = {
  create(docId: string, schema?: number): Promise<null>;
  load(docId: string): Promise<unknown>;
  append(docId: string, record: AppendRecord): Promise<number>;
  compact(docId: string, state: Uint8Array, upToSeq: number): Promise<unknown>;
  close(docId: string): Promise<null>;
  flush(): Promise<null>;
  /** The connection closed: release every document it holds. */
  dispose(): Promise<void>;
};

export type DevBridgeBackend = { connect(): DevBridgeClient };

export function memoryBackend(
  library: MemoryDocLibrary = new MemoryDocLibrary(),
): DevBridgeBackend {
  return {
    connect() {
      const store = new MemoryDocStore({ library });
      const held = new Set<string>();
      return {
        async create(docId, schema) {
          library.createDoc(docId, schema);
          return null;
        },
        async load(docId) {
          const loaded = await store.load(docId);
          held.add(docId);
          return loaded;
        },
        append: (docId, record) => store.append(docId, record),
        compact: (docId, state, upToSeq) =>
          store.compact(docId, state, upToSeq),
        async close(docId) {
          try {
            await store.close(docId);
          } finally {
            held.delete(docId);
          }
          return null;
        },
        async flush() {
          await store.flush();
          return null;
        },
        async dispose() {
          for (const docId of held) await store.close(docId);
          held.clear();
        },
      };
    },
  };
}

class BadRequest extends Error {
  readonly code = "bad_request";
}

const DOC_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const ORIGINS: ReadonlySet<string> = new Set(UPDATE_ORIGINS);
const MAX_TITLE = 200;
const MAX_SNIPPET = 400;

type Args = Record<string, unknown>;

function docId(args: Args): string {
  const id = args.docId;
  if (typeof id !== "string" || !DOC_ID.test(id)) {
    throw new BadRequest("docId");
  }
  return id;
}

function bytes(value: unknown, name: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new BadRequest(name);
  return value;
}

function seq(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new BadRequest("upToSeq");
  }
  return value as number;
}

function optionalSchema(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new BadRequest("schema");
  }
  return value as number;
}

function optionalText(value: unknown, max: number, name: string) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > max) {
    throw new BadRequest(name);
  }
  return value;
}

function appendRecord(value: unknown): AppendRecord {
  if (value === null || typeof value !== "object") {
    throw new BadRequest("record");
  }
  const record = value as Args;
  if (typeof record.origin !== "string" || !ORIGINS.has(record.origin)) {
    throw new BadRequest("origin");
  }
  const schemaTo = record.schemaTo;
  if (schemaTo !== undefined && !Number.isSafeInteger(schemaTo)) {
    throw new BadRequest("schemaTo");
  }
  return {
    origin: record.origin as UpdateOrigin,
    update: bytes(record.update, "update"),
    title: optionalText(record.title, MAX_TITLE, "title"),
    snippet: optionalText(record.snippet, MAX_SNIPPET, "snippet"),
    schemaTo: schemaTo as number | undefined,
  };
}

/** Validates `args` for `op` and runs it: the host is the trust boundary. */
export function dispatch(
  client: DevBridgeClient,
  op: DevBridgeOp,
  args: unknown,
): Promise<unknown> {
  if (args === null || typeof args !== "object") throw new BadRequest("args");
  const a = args as Args;
  switch (op) {
    case "create":
      return client.create(docId(a), optionalSchema(a.schema));
    case "load":
      return client.load(docId(a));
    case "append":
      return client.append(docId(a), appendRecord(a.record));
    case "compact":
      return client.compact(docId(a), bytes(a.state, "state"), seq(a.upToSeq));
    case "close":
      return client.close(docId(a));
    case "flush":
      return client.flush();
  }
}

/**
 * The reply's error, shaped as the real IPC's (architecture §7): a code and
 * whether to retry, never an exception's message, which may hold paths or
 * internals. Unknown failures are `internal` and logged here only.
 */
const STORE_CODES: ReadonlySet<string> = new Set(DOC_STORE_ERROR_CODES);

function errorOf(error: unknown): DevBridgeError {
  // By code, not class: the engine's errors are `{ code }`-shaped (P2.6).
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === "string" && STORE_CODES.has(code)) {
    return {
      code,
      retryable: isRetryableDocStoreError(code as DocStoreErrorCode),
    };
  }
  if (error instanceof BadRequest) {
    return { code: error.code, retryable: false };
  }
  console.error("[storage-host] internal error:", error);
  return { code: "internal", retryable: false };
}

function sameToken(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(
  client: DevBridgeClient,
  data: string | Buffer,
): Promise<DevBridgeReply> {
  let id = -1;
  try {
    if (typeof data === "string") throw new BadRequest("text frame");
    const request = decodeFrame(data) as {
      id?: unknown;
      op?: unknown;
      args?: unknown;
    };
    if (!Number.isSafeInteger(request.id)) throw new BadRequest("id");
    id = request.id as number;
    const op = request.op as DevBridgeOp;
    if (!DEV_BRIDGE_OPS.includes(op)) throw new BadRequest("op");
    const value = await dispatch(client, op, request.args);
    return { id, result: { ok: true, value: value ?? null } };
  } catch (error) {
    return { id, result: { ok: false, error: errorOf(error) } };
  }
}

export type StorageHostOptions = {
  /** Origins allowed to connect (the dev server's). */
  origins: string[];
  backend?: DevBridgeBackend;
  /** 0 picks a free port. */
  port?: number;
  token?: string;
};

export type StorageHost = { url: string; token: string; stop(): void };

/** Requests run one at a time, in order: `flush` covers every write sent before it. */
type Socket = { client: DevBridgeClient; queue: Promise<void> };

export function startStorageHost(options: StorageHostOptions): StorageHost {
  if (process.env.NODE_ENV === "production") {
    throw new Error("the dev storage host never runs in production");
  }
  const backend = options.backend ?? memoryBackend();
  const token = options.token ?? randomBytes(32).toString("hex");
  const origins = new Set(options.origins);

  const server = Bun.serve<Socket>({
    hostname: "127.0.0.1",
    port: options.port ?? 0,
    fetch(request, srv) {
      const origin = request.headers.get("origin") ?? "";
      const protocols = (request.headers.get("sec-websocket-protocol") ?? "")
        .split(",")
        .map((p) => p.trim());
      const offered = protocols.find((p) =>
        p.startsWith(`${DEV_BRIDGE_PROTOCOL}.`),
      );
      const ok =
        origins.has(origin) &&
        offered !== undefined &&
        sameToken(offered.slice(DEV_BRIDGE_PROTOCOL.length + 1), token);
      if (!ok) return new Response("Forbidden", { status: 403 });
      const upgraded = srv.upgrade(request, {
        data: { client: backend.connect(), queue: Promise.resolve() },
        headers: { "Sec-WebSocket-Protocol": offered },
      });
      return upgraded
        ? undefined
        : new Response("Upgrade required", { status: 426 });
    },
    websocket: {
      maxPayloadLength: DEV_BRIDGE_MAX_FRAME_BYTES,
      message(ws, data) {
        ws.data.queue = ws.data.queue.then(async () => {
          const reply = await handle(ws.data.client, data);
          if (ws.readyState !== 1) return;
          let frame: Uint8Array;
          try {
            frame = encodeFrame(reply);
          } catch (error) {
            frame = encodeFrame({
              id: reply.id,
              result: { ok: false, error: errorOf(error) },
            });
          }
          ws.send(frame);
        });
      },
      close(ws) {
        ws.data.queue = ws.data.queue.then(() => ws.data.client.dispose());
      },
    },
  });

  return {
    url: `ws://127.0.0.1:${server.port}`,
    token,
    stop: () => server.stop(true),
  };
}

if (import.meta.main) {
  const origins = (process.env.DESKTOP_BRIDGE_ORIGIN ?? "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  const host = startStorageHost({
    origins,
    port: Number(process.env.DESKTOP_BRIDGE_PORT ?? 0),
  });
  console.log(JSON.stringify({ url: host.url, token: host.token }));
  if (process.env.DESKTOP_BRIDGE_EXIT_ON_STDIN_EOF === "1") {
    for await (const _ of Bun.stdin.stream()) {
      // The parent never writes; only the end of the stream matters.
    }
    host.stop();
    process.exit(0);
  }
}
