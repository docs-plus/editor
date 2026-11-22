/**
 * Runs image store encodes in `encode-worker.ts`, off the main thread
 * (spec §2.3, R7), and falls back to today's main-thread canvas when the
 * worker can't be created, its chunk fails to load (offline before first
 * use, or after a deploy), or it has no `OffscreenCanvas`.
 *
 * One worker serves every request and ends after 30 s idle, so a decoded
 * 40 MP bitmap's memory is not held for the session.
 */
import {
  type EncodeRequest,
  type EncodeResult,
  encodeUnderByteCap,
} from "@/lib/assets/encode-image";
import {
  createCanvasEncoder,
  type EncodeAttempt,
  loadImage,
  MAX_DECODE_PIXELS,
  supportsWebpEncoding,
  throwIfAborted,
} from "@/lib/image-downscale";

export type EncodeWorkerRequest = EncodeRequest & { id: number; blob: Blob };
export type EncodeWorkerReply = { id: number } & (
  | EncodeResult
  | { ok: false; error: "unsupported" }
);

export type ImageEncodeFn = (
  blob: Blob,
  request: EncodeRequest,
  signal?: AbortSignal,
) => Promise<EncodeResult>;

const IDLE_MS = 30_000;

type Pending = {
  resolve: (result: EncodeResult | null) => void;
};

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
  /** Schedules the idle shutdown; returns its cancel. */
  setTimer?: (fn: () => void, ms?: number) => () => void;
}): ImageEncodeFn {
  let worker: Worker | null = null;
  let disabled = false;
  let nextId = 1;
  let cancelIdle: (() => void) | null = null;
  const pending = new Map<number, Pending>();

  /** `null` for every pending request: each one falls back. */
  const shutDown = (disable: boolean) => {
    worker?.terminate();
    worker = null;
    if (disable) disabled = true;
    for (const entry of pending.values()) entry.resolve(null);
    pending.clear();
  };

  const scheduleIdle = () => {
    cancelIdle?.();
    cancelIdle =
      pending.size === 0 ? setTimer(() => shutDown(false), IDLE_MS) : null;
  };

  const getWorker = (): Worker | null => {
    if (disabled) return null;
    if (worker) return worker;
    try {
      const created = createWorker();
      created.addEventListener("message", (event: MessageEvent) => {
        const reply = event.data as EncodeWorkerReply;
        const entry = pending.get(reply.id);
        if (!entry) return;
        pending.delete(reply.id);
        if (!reply.ok && reply.error === "unsupported") {
          shutDown(true);
          entry.resolve(null);
          return;
        }
        const { id: _id, ...result } = reply;
        entry.resolve(result as EncodeResult);
        scheduleIdle();
      });
      created.addEventListener("error", () => shutDown(true));
      worker = created;
      return created;
    } catch {
      disabled = true;
      return null;
    }
  };

  return async (blob, request, signal) => {
    throwIfAborted(signal);
    const target = getWorker();
    if (!target) return fallback(blob, request, signal);
    cancelIdle?.();
    cancelIdle = null;
    const id = nextId++;
    const result = await new Promise<EncodeResult | null>((resolve, reject) => {
      const onAbort = () => {
        pending.delete(id);
        scheduleIdle();
        reject(new Error("Upload cancelled"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(value);
        },
      });
      target.postMessage({
        id,
        blob,
        ...request,
      } satisfies EncodeWorkerRequest);
    });
    return result ?? fallback(blob, request, signal);
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
    if (width * height > MAX_DECODE_PIXELS)
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
