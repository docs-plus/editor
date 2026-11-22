/**
 * The image store's encode worker (spec §2.3): decodes with
 * `createImageBitmap` and re-encodes with `OffscreenCanvas.convertToBlob`,
 * one request at a time (each holds a decoded bitmap, up to 40 MP).
 *
 * Replies `{ id, ok: false, error: "unsupported" }` where the worker has no
 * `OffscreenCanvas` (older Safari, Bun); the client then encodes on the main
 * thread instead.
 */

import type {
  EncodeWorkerReply,
  EncodeWorkerRequest,
} from "@/lib/assets/encode-client";
import {
  type EncodeDeps,
  encodeImageUnderCap,
} from "@/lib/assets/encode-image";

const scope = globalThis as unknown as {
  postMessage(message: EncodeWorkerReply): void;
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<EncodeWorkerRequest>) => void,
  ): void;
};

const deps: EncodeDeps | null =
  typeof OffscreenCanvas === "function" &&
  typeof createImageBitmap === "function"
    ? {
        createImageBitmap: (source, options) =>
          createImageBitmap(source, options),
        createCanvas: (width, height) =>
          new OffscreenCanvas(width, height) as unknown as ReturnType<
            EncodeDeps["createCanvas"]
          >,
      }
    : null;

let queue: Promise<void> = Promise.resolve();

// Tells the client the module loaded: a later `error` is a crash, not a
// chunk that failed to load.
scope.postMessage({ ready: true });

scope.addEventListener("message", (event) => {
  const { id, blob, maxBytes, maxSide } = event.data;
  queue = queue.then(async () => {
    if (!deps) {
      scope.postMessage({ id, ok: false, error: "unsupported" });
      return;
    }
    const result = await encodeImageUnderCap(
      blob,
      { maxBytes, maxSide },
      deps,
    ).catch(() => ({ ok: false, error: "decode" }) as const);
    scope.postMessage({ id, ...result });
  });
});
