import { afterEach, describe, expect, it } from "bun:test";

import {
  createWorkerEncoder,
  type EncodeWorkerReply,
  type EncodeWorkerRequest,
  type ImageEncodeFn,
} from "@/lib/assets/encode-client";
import type { EncodeResult } from "@/lib/assets/encode-image";

const REQUEST = { maxBytes: 1024, maxSide: 2560 };
const blob = new Blob([new Uint8Array(4)], { type: "image/jpeg" });
const okResult: EncodeResult = {
  ok: true,
  blob: new Blob([new Uint8Array(2)], { type: "image/webp" }),
  width: 2,
  height: 1,
};

/** A worker that answers each request with `reply(request)`, or never. */
class FakeWorker {
  static created = 0;
  terminated = false;
  sent: EncodeWorkerRequest[] = [];
  private listeners: Record<string, ((event: unknown) => void)[]> = {};

  constructor(
    private readonly reply?: (
      request: EncodeWorkerRequest,
    ) => EncodeWorkerReply,
  ) {
    FakeWorker.created += 1;
  }

  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners[type] = [...(this.listeners[type] ?? []), listener];
  }

  postMessage(request: EncodeWorkerRequest) {
    this.sent.push(request);
    const reply = this.reply;
    if (reply) {
      queueMicrotask(() => this.emit("message", { data: reply(request) }));
    }
  }

  emit(type: string, event: unknown) {
    for (const listener of this.listeners[type] ?? []) listener(event);
  }

  terminate() {
    this.terminated = true;
  }
}

const fallbackCalls: Blob[] = [];
const fallback: ImageEncodeFn = async (source) => {
  fallbackCalls.push(source);
  return okResult;
};

afterEach(() => {
  fallbackCalls.length = 0;
  FakeWorker.created = 0;
});

describe("createWorkerEncoder", () => {
  it("encodes in the worker and passes the result through", async () => {
    let worker: FakeWorker | undefined;
    const encode = createWorkerEncoder({
      createWorker: () => {
        worker = new FakeWorker((request) => ({ id: request.id, ...okResult }));
        return worker as unknown as Worker;
      },
      fallback,
    });
    expect(await encode(blob, REQUEST)).toEqual(okResult);
    expect(worker?.sent[0]).toMatchObject({ blob, ...REQUEST });
    expect(fallbackCalls).toEqual([]);
  });

  it("reuses one worker for several requests", async () => {
    const encode = createWorkerEncoder({
      createWorker: () =>
        new FakeWorker((request) => ({
          id: request.id,
          ...okResult,
        })) as unknown as Worker,
      fallback,
    });
    await Promise.all([encode(blob, REQUEST), encode(blob, REQUEST)]);
    expect(FakeWorker.created).toBe(1);
  });

  it("falls back to the main thread when the worker has no OffscreenCanvas, for good", async () => {
    let worker: FakeWorker | undefined;
    const encode = createWorkerEncoder({
      createWorker: () => {
        worker = new FakeWorker((request) => ({
          id: request.id,
          ok: false,
          error: "unsupported",
        }));
        return worker as unknown as Worker;
      },
      fallback,
    });
    expect(await encode(blob, REQUEST)).toEqual(okResult);
    expect(worker?.terminated).toBe(true);
    await encode(blob, REQUEST);
    expect(FakeWorker.created).toBe(1);
    expect(fallbackCalls).toHaveLength(2);
  });

  it("falls back when the worker cannot be created (CSP, old browser)", async () => {
    const encode = createWorkerEncoder({
      createWorker: () => {
        throw new Error("blocked");
      },
      fallback,
    });
    expect(await encode(blob, REQUEST)).toEqual(okResult);
  });

  it("falls back for pending requests when the worker chunk fails to load", async () => {
    let worker: FakeWorker | undefined;
    const encode = createWorkerEncoder({
      createWorker: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
      fallback,
    });
    const pending = encode(blob, REQUEST);
    worker?.emit("error", new Event("error"));
    expect(await pending).toEqual(okResult);
    expect(worker?.terminated).toBe(true);
  });

  it("passes encode errors through instead of falling back", async () => {
    const encode = createWorkerEncoder({
      createWorker: () =>
        new FakeWorker((request) => ({
          id: request.id,
          ok: false,
          error: "shrink",
        })) as unknown as Worker,
      fallback,
    });
    expect(await encode(blob, REQUEST)).toEqual({ ok: false, error: "shrink" });
    expect(fallbackCalls).toEqual([]);
  });

  it("rejects at once when cancelled and ignores the late reply", async () => {
    let worker: FakeWorker | undefined;
    const encode = createWorkerEncoder({
      createWorker: () => {
        worker = new FakeWorker();
        return worker as unknown as Worker;
      },
      fallback,
    });
    const controller = new AbortController();
    const pending = encode(blob, REQUEST, controller.signal);
    controller.abort();
    await expect(pending).rejects.toThrow("Upload cancelled");
    const id = worker?.sent[0]?.id ?? -1;
    worker?.emit("message", { data: { id, ...okResult } });
  });

  it("ends an idle worker, and starts a new one for the next image", async () => {
    let timer: (() => void) | undefined;
    const workers: FakeWorker[] = [];
    const encode = createWorkerEncoder({
      createWorker: () => {
        const worker = new FakeWorker((request) => ({
          id: request.id,
          ...okResult,
        }));
        workers.push(worker);
        return worker as unknown as Worker;
      },
      fallback,
      setTimer: (fn) => {
        timer = fn;
        return () => {
          timer = undefined;
        };
      },
    });
    await encode(blob, REQUEST);
    expect(workers[0]?.terminated).toBe(false);
    timer?.();
    expect(workers[0]?.terminated).toBe(true);
    await encode(blob, REQUEST);
    expect(workers).toHaveLength(2);
  });
});

describe("encode worker in Bun (no OffscreenCanvas)", () => {
  it("loads and answers unsupported, so the client uses the main thread", async () => {
    const worker = new Worker(
      new URL("../../../../lib/assets/encode-worker.ts", import.meta.url),
      { type: "module" },
    );
    try {
      const reply = await new Promise<EncodeWorkerReply>((resolve, reject) => {
        worker.addEventListener("message", (event) => resolve(event.data));
        worker.addEventListener("error", reject);
        worker.postMessage({ id: 7, blob, ...REQUEST });
      });
      expect(reply).toEqual({ id: 7, ok: false, error: "unsupported" });
    } finally {
      worker.terminate();
    }
  });
});
