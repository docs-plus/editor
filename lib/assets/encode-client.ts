/**
 * Runs image store encodes in `encode-worker.ts`, off the main thread
 * (spec §2.3, R7), and falls back to today's main-thread canvas when the
 * worker can't be created, its chunk fails to load (offline before first
 * use, or after a deploy), it has no `OffscreenCanvas`, or a request takes
 * longer than 60 s.
 *
 * A worker that crashes after loading (a decoder bomb, out of memory) fails
 * the request instead: the same bytes are never retried on the main
 * thread. A request with `mainThread: false` (its size could not be read
 * from the header) never falls back at all.
 *
 * One worker serves every request and ends after 30 s idle, so a decoded
 * 40 MP bitmap's memory is not held for the session.
 */
import {
  type EncodeRequest,
  type EncodeResult,
  encodeUnderByteCap,
} from "@/lib/assets/encode-image";
import { MAX_ASSET_PIXELS } from "@/lib/assets/limits";
import {
  createCanvasEncoder,
  type EncodeAttempt,
  loadImage,
  supportsWebpEncoding,
  throwIfAborted,
} from "@/lib/image-downscale";

export type EncodeWorkerRequest = EncodeRequest & { id: number; blob: Blob };
export type EncodeWorkerReply =
  /** Posted once, when the worker's module has loaded. */
  | { ready: true }
  | ({ id: number } & (EncodeResult | { ok: false; error: "unsupported" }));

export interface EncodeCallOptions {
  /**
   * False when the image's size is unknown before decoding (AVIF, HEIC,
   * BMP): a pixel bomb must not reach a main-thread decoder. Default true.
   */
  mainThread?: boolean;
}

export type ImageEncodeFn = (
  blob: Blob,
  request: EncodeRequest,
  signal?: AbortSignal,
  options?: EncodeCallOptions,
) => Promise<EncodeResult>;

const IDLE_MS = 30_000;
/** A request the worker has not answered by then falls back. */
export const ENCODE_TIMEOUT_MS = 60_000;

const DECODE_FAILED: EncodeResult = { ok: false, error: "decode" };

/** What a pending request settles with: a result, or `null` to fall back. */
type Pending = { settle: (result: EncodeResult | null) => void };

export function createWorkerEncoder({
  createWorker,
  fallback,
  setTimer = (fn, ms = IDLE_MS) => {
    const id = setTimeout(fn, ms);
    return () => clearTimeout(id);
  },
}: {
  createWorker: () => Worker;
  fallback: ImageEncodeFn;
  /** Schedules the idle shutdown and request timeouts; returns a cancel. */
  setTimer?: (fn: () => void, ms?: number) => () => void;
}): ImageEncodeFn {
  let worker: Worker | null = null;
  let ready = false;
  let disabled = false;
  let nextId = 1;
  let cancelIdle: (() => void) | null = null;
  const pending = new Map<number, Pending>();

  /** Ends the worker; every pending request settles with `result`. */
  const shutDown = (result: EncodeResult | null, disable: boolean) => {
    worker?.terminate();
    worker = null;
    ready = false;
    if (disable) disabled = true;
    const settling = [...pending.values()];
    pending.clear();
    for (const entry of settling) entry.settle(result);
  };

  const scheduleIdle = () => {
    cancelIdle?.();
    cancelIdle =
      pending.size === 0
        ? setTimer(() => shutDown(null, false), IDLE_MS)
        : null;
  };

  /** Before `ready`: the chunk did not load (fall back, for good). After: a crash. */
  const onFailure = () =>
    ready ? shutDown(DECODE_FAILED, false) : shutDown(null, true);

  const getWorker = (): Worker | null => {
    if (disabled) return null;
    if (worker) return worker;
    try {
      const created = createWorker();
      created.addEventListener("message", (event: MessageEvent) => {
        const reply = event.data as EncodeWorkerReply;
        if ("ready" in reply) {
          ready = true;
          return;
        }
        const entry = pending.get(reply.id);
        if (!entry) return;
        pending.delete(reply.id);
        if (!reply.ok && reply.error === "unsupported") {
          shutDown(null, true);
          entry.settle(null);
          return;
        }
        const { id: _id, ...result } = reply;
        entry.settle(result as EncodeResult);
        scheduleIdle();
      });
      created.addEventListener("error", onFailure);
      // A reply that cannot be deserialized: the worker is not usable.
      created.addEventListener("messageerror", () =>
        shutDown(DECODE_FAILED, false),
      );
      worker = created;
      return created;
    } catch {
      disabled = true;
      return null;
    }
  };

  return async (blob, request, signal, options = {}) => {
    throwIfAborted(signal);
    const mainThread = options.mainThread ?? true;
    const fallBack = () =>
      mainThread ? fallback(blob, request, signal, options) : DECODE_FAILED;
    const target = getWorker();
    if (!target) return fallBack();
    cancelIdle?.();
    cancelIdle = null;
    const id = nextId++;
    const result = await new Promise<EncodeResult | null>((resolve, reject) => {
      let cancelTimeout = () => {};
      const finish = () => {
        cancelTimeout();
        signal?.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        pending.delete(id);
        finish();
        scheduleIdle();
        reject(new Error("Upload cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      pending.set(id, {
        settle: (value) => {
          finish();
          resolve(value);
        },
      });
      cancelTimeout = setTimer(() => {
        if (!pending.has(id)) return;
        // A stuck worker holds every later request too: replace it.
        shutDown(null, false);
      }, ENCODE_TIMEOUT_MS);
      try {
        target.postMessage({
          id,
          blob,
          ...request,
        } satisfies EncodeWorkerRequest);
      } catch {
        // DataCloneError: the request never reached the worker.
        pending.delete(id);
        finish();
        scheduleIdle();
        resolve(null);
      }
    });
    return result ?? fallBack();
  };
}

/** Today's canvas path on the main thread, with the asset byte cap. */
export const encodeOnMainThread: ImageEncodeFn = async (
  blob,
  { maxBytes, maxSide },
  signal,
) => {
  const url = URL.createObjectURL(blob);
  try {
    let image: HTMLImageElement;
    try {
      image = await loadImage(url);
    } catch {
      return { ok: false, error: "decode" };
    }
    throwIfAborted(signal);
    const { naturalWidth: width, naturalHeight: height } = image;
    if (width === 0 || height === 0) return { ok: false, error: "decode" };
    if (width * height > MAX_ASSET_PIXELS)
      return { ok: false, error: "pixels" };
    const type = (await supportsWebpEncoding()) ? "image/webp" : "image/jpeg";
    const canvasEncoder = createCanvasEncoder(image, type);
    let last = { width, height };
    try {
      const out = await encodeUnderByteCap(
        {
          width,
          height,
          encode: (attempt: EncodeAttempt) => {
            last = attempt;
            return canvasEncoder.encode(attempt);
          },
        },
        maxBytes,
        maxSide,
        signal,
      );
      return out
        ? { ok: true, blob: out, width: last.width, height: last.height }
        : { ok: false, error: "shrink" };
    } finally {
      canvasEncoder.dispose();
    }
  } finally {
    URL.revokeObjectURL(url);
  }
};

/** The app's encoder: the worker, else the main thread. */
export const encodeAssetImage: ImageEncodeFn = createWorkerEncoder({
  createWorker: () =>
    new Worker(new URL("./encode-worker.ts", import.meta.url), {
      type: "module",
    }),
  fallback: encodeOnMainThread,
});
