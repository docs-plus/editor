/**
 * `doc-handlers` (desktop architecture §2, §7, §8.1): the Electron-free core
 * of main's IPC. Each handler takes the calling window and the raw request,
 * runs the channel's guard, checks the open-document registry, and forwards
 * to the storage worker with the window as `owner`. It answers with an
 * `IpcResult`; nothing is thrown across.
 *
 * The sender check (top frame, app origin, a window main created) happens
 * before this, in the adapter (`ipc.ts`), because it needs Electron. The dev
 * storage host (P2.4b) runs this same core over a WebSocket.
 */

import type { IpcResult } from "../shared/errors";
import { type ErrorCode, fail, isErrorCode, ok } from "../shared/errors";
import {
  type CallArgs,
  type CallChannel,
  type CallResult,
  calls,
  IPC_BUILD,
} from "../shared/ipc-contract";
import type { StorageOp, StorageOps } from "../storage/protocol";
import type { OpenDocRegistry } from "./registry";

export type StorageCall = <K extends StorageOp>(
  op: K,
  args: StorageOps[K]["args"],
) => Promise<StorageOps[K]["result"]>;

export type DocHandlerDeps = {
  registry: OpenDocRegistry;
  call: StorageCall;
  /** Brings a window forward (a document it holds was opened elsewhere). */
  focusWindow: (windowId: number) => void;
  /** The document main opened this window for, if any. */
  windowDoc: (windowId: number) => string | null;
  /** The build this main was made from (tests pass their own). */
  build?: string;
  /** Opens a link in the system browser (`shell.openLink`); true if it did. */
  openLink?: (windowId: number, url: string) => boolean;
  /** Answers `app.flushed` (the quit coordinator). */
  onFlushed?: (windowId: number, requestId: number) => void;
};

export type DocHandler = (
  windowId: number,
  raw: unknown,
) => Promise<IpcResult<unknown>>;

/** The storage worker's owner id for a window. */
export const ownerOf = (windowId: number) => `w${windowId}`;

/** A rejection from the worker client becomes its code; anything else is a dead transport. */
export function errorCodeOf(error: unknown): ErrorCode {
  const code = (error as { code?: unknown } | null)?.code;
  return isErrorCode(code) ? code : "library_unavailable";
}

export type DocHandlers = {
  /** The raw per-channel handlers (no build gate), for tests. */
  handlers: Record<CallChannel, DocHandler>;
  /**
   * What the IPC adapter calls: refuses every channel but `app.hello` with
   * `build_mismatch` until this window's preload has said hello with the
   * same build (architecture §7 `IPC_BUILD`).
   */
  dispatch(
    channel: CallChannel,
    windowId: number,
    raw: unknown,
  ): Promise<IpcResult<unknown>>;
  /** The window closed or loaded a new document: it must say hello again. */
  forgetWindow(windowId: number): void;
};

export function createDocHandlers(deps: DocHandlerDeps): DocHandlers {
  const greeted = new Set<number>();
  const handlers = createRawHandlers(deps, greeted);
  return {
    handlers,
    dispatch(channel, windowId, raw) {
      if (channel !== "app.hello" && !greeted.has(windowId))
        return Promise.resolve(fail("build_mismatch"));
      return handlers[channel](windowId, raw);
    },
    forgetWindow(windowId) {
      greeted.delete(windowId);
    },
  };
}

function createRawHandlers(
  deps: DocHandlerDeps,
  greeted: Set<number>,
): Record<CallChannel, DocHandler> {
  const { registry, call, focusWindow } = deps;
  const build = deps.build ?? IPC_BUILD;

  const forward = async <T>(run: () => Promise<T>): Promise<IpcResult<T>> => {
    try {
      return ok(await run());
    } catch (error) {
      return fail(errorCodeOf(error));
    }
  };

  /** Validates, then runs `handle` with typed arguments. */
  const typed =
    <C extends CallChannel>(
      channel: C,
      handle: (
        windowId: number,
        args: CallArgs<C>,
      ) => Promise<IpcResult<CallResult<C>>>,
    ): DocHandler =>
    async (windowId, raw) => {
      if (!calls[channel].req(raw)) return fail("invalid_argument");
      return handle(windowId, raw as CallArgs<C>);
    };

  const requireHolder = (docId: string, windowId: number) =>
    registry.holds(docId, windowId) ? null : fail("forbidden");

  return {
    "app.hello": typed("app.hello", async (windowId, { build: theirs }) => {
      if (theirs !== build) {
        greeted.delete(windowId);
        return fail("build_mismatch");
      }
      greeted.add(windowId);
      return ok({ docId: deps.windowDoc(windowId) });
    }),

    "app.flushed": typed("app.flushed", async (windowId, { requestId }) => {
      deps.onFlushed?.(windowId, requestId);
      return ok(null);
    }),

    "doc.open": typed("doc.open", async (windowId, { docId }) => {
      const claimed = registry.claim(docId, windowId);
      if (!claimed.ok) {
        focusWindow(claimed.holder);
        return fail("already_open");
      }
      const result = await forward(() =>
        call("load", { docId, owner: ownerOf(windowId) }),
      );
      // A load that fails leaves the document closed, unless main opened
      // this window for it (the window keeps its document either way).
      if (!result.ok && deps.windowDoc(windowId) !== docId)
        registry.release(docId, windowId);
      return result;
    }),

    "doc.append": typed("doc.append", async (windowId, { docId, record }) => {
      const refused = requireHolder(docId, windowId);
      if (refused) return refused;
      return forward(() =>
        call("append", { docId, owner: ownerOf(windowId), record }),
      );
    }),

    "doc.compact": typed(
      "doc.compact",
      async (windowId, { docId, state, upToSeq }) => {
        const refused = requireHolder(docId, windowId);
        if (refused) return refused;
        return forward(() =>
          call("compact", {
            docId,
            owner: ownerOf(windowId),
            state,
            upToSeq,
          }),
        );
      },
    ),

    "doc.close": typed("doc.close", async (windowId, { docId }) => {
      const refused = requireHolder(docId, windowId);
      if (refused) return refused;
      const result = await forward(() =>
        call("close", { docId, owner: ownerOf(windowId) }),
      );
      registry.release(docId, windowId);
      return result;
    }),

    "shell.openLink": typed("shell.openLink", async (windowId, { url }) =>
      ok({ opened: deps.openLink?.(windowId, url) ?? false }),
    ),

    "doc.flush": typed("doc.flush", async () =>
      forward(() => call("flush", {})),
    ),

    "index.create": typed("index.create", async (_windowId, { title }) =>
      forward(async () => {
        const created = await call(
          "createDoc",
          title === undefined ? {} : { title },
        );
        return { id: created.id };
      }),
    ),
  };
}
