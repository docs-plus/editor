/**
 * The typed bridge between a renderer and main (desktop architecture §7).
 * Every channel is declared once, here, with the guard main runs on its
 * request. Main validates, the preload only forwards, and the renderer
 * trusts replies, so the renderer bundle carries no guard code.
 *
 * Request and result shapes for `doc.*` match `DocStoreCalls` in
 * `lib/platform/desktop/rpc-doc-store.ts`, so the renderer's `IpcDocStore`
 * is `createRpcDocStore` over `window.tinydocy.invoke` with a channel map
 * ({@link DOC_STORE_CHANNELS}).
 *
 * Channels this PR serves (P2.5). Later PRs add `index.*`, `dialog.*`,
 * `prefs.*` and `asset.*` here, each with its guard.
 */
import { UPDATE_ORIGINS_MIRROR } from "./doc-origins";
import type { ErrorCode, IpcResult } from "./errors";
import {
  arr,
  bytes,
  type Guard,
  type Infer,
  int,
  obj,
  oneOf,
  opt,
  str,
  uuid,
} from "./guard";
import {
  MAX_BATCH_BYTES,
  MAX_BUILD_ID_LENGTH,
  MAX_DOC_BYTES,
  MAX_DOC_SCHEMA,
  MAX_SNIPPET_LENGTH,
  MAX_TITLE_LENGTH,
} from "./limits";

/** Replaced with the git SHA by `desktop/build/build.ts` (`define`). */
declare const __TINYDOCY_IPC_BUILD__: string | undefined;

/**
 * The build both sides were made from. The preload sends it in `app.hello`
 * and main refuses a mismatch (`build_mismatch`). "dev" when not bundled.
 */
export const IPC_BUILD: string =
  typeof __TINYDOCY_IPC_BUILD__ === "string" ? __TINYDOCY_IPC_BUILD__ : "dev";

const docId = obj({ docId: uuid });

const appendRecord = obj({
  origin: oneOf(UPDATE_ORIGINS_MIRROR),
  update: bytes(MAX_BATCH_BYTES),
  title: opt(str(MAX_TITLE_LENGTH)),
  snippet: opt(str(MAX_SNIPPET_LENGTH)),
  schemaTo: opt(int(0, MAX_DOC_SCHEMA)),
});

/** renderer → main (`ipcRenderer.invoke`). `res` documents the result type. */
export const calls = {
  /** First call from every window: build check, and which document it is for. */
  "app.hello": {
    req: obj({ build: str(MAX_BUILD_ID_LENGTH) }),
    res: {} as { docId: string | null },
  },
  /** Reply to `app.flushRequested` once every batch is acked. */
  "app.flushed": {
    req: obj({ requestId: int(1) }),
    res: null,
  },
  /** Load and claim (registry). Another window holding it: `already_open`, and main focuses that window. */
  "doc.open": {
    req: docId,
    res: {} as {
      snapshot: Uint8Array | null;
      updates: Uint8Array[];
      maxSeq: number;
      schema: number;
    },
  },
  "doc.append": {
    req: obj({ docId: uuid, record: appendRecord }),
    res: 0 as number,
  },
  "doc.compact": {
    req: obj({ docId: uuid, state: bytes(MAX_DOC_BYTES), upToSeq: int() }),
    res: {} as { foreign: null },
  },
  "doc.close": { req: docId, res: null },
  /** Resolves after every request this window sent before it is durable. */
  "doc.flush": { req: obj({}), res: null },
  /** Creates an empty document (the library's `createDoc`); P2.7 grows `index.*`. */
  "index.create": {
    req: obj({ title: opt(str(MAX_TITLE_LENGTH)) }),
    res: {} as { id: string },
  },
} as const satisfies Record<string, { req: Guard<unknown>; res: unknown }>;

export type CallChannel = keyof typeof calls;
export type CallArgs<C extends CallChannel> = Infer<(typeof calls)[C]["req"]>;
export type CallResult<C extends CallChannel> = (typeof calls)[C]["res"];

export const CALL_CHANNELS = Object.keys(calls) as CallChannel[];

export function isCallChannel(value: unknown): value is CallChannel {
  return typeof value === "string" && Object.hasOwn(calls, value);
}

/** `DocStoreCalls` op → channel, for the renderer's `IpcDocStore`. */
export const DOC_STORE_CHANNELS = {
  load: "doc.open",
  append: "doc.append",
  compact: "doc.compact",
  close: "doc.close",
  flush: "doc.flush",
} as const satisfies Record<string, CallChannel>;

/** main → renderer (`webContents.send`). */
export const events = {
  /**
   * Flush every batcher now (compaction skipped), then answer with
   * `app.flushed`. Main waits at most 3 s on quit (architecture §6.3).
   */
  "app.flushRequested": obj({
    requestId: int(1),
    reason: oneOf(["quit", "close"] as const),
  }),
  /** Library metadata changed; the sidebar refetches what it shows. */
  "index.changed": obj({
    rev: int(),
    changes: arr(
      obj({ kind: oneOf(["doc", "folder", "tag"] as const), id: str(64) }),
      100_000,
    ),
  }),
} as const satisfies Record<string, Guard<unknown>>;

export type EventChannel = keyof typeof events;
export type EventPayload<E extends EventChannel> = Infer<(typeof events)[E]>;

export const EVENT_CHANNELS = Object.keys(events) as EventChannel[];

/** What the preload puts on `window.tinydocy`. */
export interface TinydocyBridge {
  readonly build: string;
  invoke<C extends CallChannel>(
    channel: C,
    args: CallArgs<C>,
  ): Promise<IpcResult<CallResult<C>>>;
  /**
   * Subscribes to a main event. For `app.flushRequested` the listener may
   * return a promise: the preload answers `app.flushed` when every
   * listener's promise settles, or at once when there is no listener.
   */
  on<E extends EventChannel>(
    channel: E,
    listener: (payload: EventPayload<E>) => void | Promise<void>,
  ): () => void;
}

export type { ErrorCode, IpcResult };
