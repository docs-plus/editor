import { describe, expect, it } from "bun:test";

import { createObjectUrlCache } from "@/lib/assets/object-url-cache";
import { FakeClock, settle } from "@/tests/helpers/platform-fakes";

const HEX_A = "a".repeat(64);
const HEX_B = "b".repeat(64);

function setup() {
  const clock = new FakeClock();
  let created = 0;
  let revoked = 0;
  const live = new Set<string>();
  const cache = createObjectUrlCache({
    clock,
    graceMs: 30_000,
    urls: {
      create: () => {
        created += 1;
        const url = `blob:test/${created}`;
        live.add(url);
        return url;
      },
      revoke: (url) => {
        revoked += 1;
        expect(live.delete(url)).toBe(true);
      },
    },
  });
  const loads: string[] = [];
  const load = (hex: string) => async () => {
    loads.push(hex);
    return new Blob([hex], { type: "image/png" });
  };
  return {
    cache,
    clock,
    load,
    loads,
    counts: () => ({ created, revoked, live: live.size }),
  };
}

describe("object-URL cache", () => {
  it("makes one URL per hash and shares one load between callers", async () => {
    const { cache, load, loads, counts } = setup();
    const detach = cache.attach();
    const a = new AbortController();
    const b = new AbortController();
    const [first, second] = await Promise.all([
      cache.acquire(HEX_A, load(HEX_A), a.signal),
      cache.acquire(HEX_A, load(HEX_A), b.signal),
    ]);
    expect(first).toBe("blob:test/1");
    expect(second).toBe(first);
    expect(loads).toEqual([HEX_A]);
    expect(counts().created).toBe(1);
    detach();
  });

  it("peek retains a warm URL synchronously and misses a cold one", async () => {
    const { cache, load } = setup();
    const detach = cache.attach();
    const holder = new AbortController();
    expect(cache.peek(HEX_A, holder.signal)).toBeNull();
    await cache.acquire(HEX_A, load(HEX_A), holder.signal);
    const view = new AbortController();
    expect(cache.peek(HEX_A, view.signal)).toBe("blob:test/1");
    detach();
  });

  it("revokes 30 s after the last release, and a reuse in between keeps it", async () => {
    const { cache, clock, load, counts } = setup();
    const detach = cache.attach();
    const first = new AbortController();
    await cache.acquire(HEX_A, load(HEX_A), first.signal);
    first.abort();
    await clock.advance(29_000);
    expect(counts().revoked).toBe(0);
    // A tab switch back within the grace reuses the URL.
    const again = new AbortController();
    expect(cache.peek(HEX_A, again.signal)).toBe("blob:test/1");
    await clock.advance(60_000);
    expect(counts().revoked).toBe(0);
    again.abort();
    await clock.advance(30_000);
    expect(counts()).toEqual({ created: 1, revoked: 1, live: 0 });
    expect(clock.pending).toBe(0);
    detach();
  });

  it("an abort before the load finishes leaks nothing", async () => {
    const { cache, clock, load, counts } = setup();
    const detach = cache.attach();
    const controller = new AbortController();
    const pending = cache.acquire(HEX_A, load(HEX_A), controller.signal);
    controller.abort();
    expect(await pending).toBeNull();
    await clock.advance(30_000);
    expect(counts().live).toBe(0);
    expect(counts().created).toBe(counts().revoked);
    detach();
  });

  it("returns null for missing bytes and does not remember the miss", async () => {
    const { cache } = setup();
    const detach = cache.attach();
    const signal = new AbortController().signal;
    expect(await cache.acquire(HEX_A, async () => null, signal)).toBeNull();
    expect(
      await cache.acquire(HEX_A, async () => new Blob(["x"]), signal),
    ).toBe("blob:test/1");
    expect(
      await cache.acquire(
        HEX_B,
        async () => {
          throw new Error("io");
        },
        signal,
      ),
    ).toBeNull();
    detach();
  });

  it("an already aborted signal acquires nothing", async () => {
    const { cache, load, counts } = setup();
    const detach = cache.attach();
    const controller = new AbortController();
    controller.abort();
    expect(
      await cache.acquire(HEX_A, load(HEX_A), controller.signal),
    ).toBeNull();
    expect(cache.peek(HEX_A, controller.signal)).toBeNull();
    expect(counts().created).toBe(0);
    detach();
  });

  it("revokes every URL when the last editor detaches", async () => {
    const { cache, clock, load, counts } = setup();
    const detachA = cache.attach();
    const detachB = cache.attach();
    const held = new AbortController();
    await cache.acquire(HEX_A, load(HEX_A), held.signal);
    await cache.acquire(HEX_B, load(HEX_B), new AbortController().signal);
    detachA();
    expect(counts().revoked).toBe(0);
    detachB();
    expect(counts()).toEqual({ created: 2, revoked: 2, live: 0 });
    expect(clock.pending).toBe(0);
    // A release after the purge is harmless.
    held.abort();
    await clock.advance(60_000);
    expect(counts().revoked).toBe(2);
  });

  it("a load that lands after the purge creates no URL", async () => {
    const { cache, counts } = setup();
    const detach = cache.attach();
    let finish: (blob: Blob) => void = () => {};
    const pending = cache.acquire(
      HEX_A,
      () => new Promise<Blob>((resolve) => (finish = resolve)),
      new AbortController().signal,
    );
    detach();
    finish(new Blob(["x"]));
    expect(await pending).toBeNull();
    expect(counts().created).toBe(0);
  });

  it("churn: creates equal revokes after acquire/release churn and editor destroy (R2)", async () => {
    const { cache, clock, load, counts } = setup();
    let random = 7;
    const next = () => {
      random = (random * 48271) % 2147483647;
      return random / 2147483647;
    };
    const hexes = Array.from({ length: 12 }, (_, i) =>
      i.toString(16).repeat(64).slice(0, 64),
    );
    for (let round = 0; round < 20; round++) {
      const detach = cache.attach();
      const views: AbortController[] = [];
      for (let i = 0; i < 40; i++) {
        const view = new AbortController();
        views.push(view);
        const hex = hexes[Math.floor(next() * hexes.length)];
        if (next() < 0.5 && cache.peek(hex, view.signal)) continue;
        void cache.acquire(hex, load(hex), view.signal);
        if (next() < 0.3) view.abort();
      }
      await settle();
      for (const view of views) if (next() < 0.7) view.abort();
      await clock.advance(Math.floor(next() * 60_000));
      for (const view of views) view.abort();
      detach();
    }
    await settle();
    expect(counts().created).toBeGreaterThan(0);
    expect(counts().created).toBe(counts().revoked);
    expect(counts().live).toBe(0);
    expect(clock.pending).toBe(0);
  });
});
