import { describe, expect, it } from "bun:test";

import { createAssetResolver } from "@/lib/assets/asset-resolver";
import { createObjectUrlCache } from "@/lib/assets/object-url-cache";
import { MemoryBlobStore } from "@/lib/platform/memory-blob-store";
import { contractImage } from "@/tests/helpers/blob-store-contract";
import { FakeClock } from "@/tests/helpers/platform-fakes";

function fakeEditor() {
  const listeners: (() => void)[] = [];
  return {
    on: (_event: "destroy", listener: () => void) => listeners.push(listener),
    destroy: () => {
      for (const listener of listeners) listener();
    },
  };
}

function setup() {
  let created = 0;
  let revoked = 0;
  const cache = createObjectUrlCache({
    clock: new FakeClock(),
    urls: {
      create: () => `blob:test/${++created}`,
      revoke: () => {
        revoked += 1;
      },
    },
  });
  return {
    resolver: createAssetResolver(cache),
    counts: () => ({ created, revoked }),
  };
}

describe("asset resolver", () => {
  it("uses the store's synchronous URL (desktop) without an object URL", async () => {
    const { resolver, counts } = setup();
    const store = new MemoryBlobStore({
      syncUrl: (hex) => `app://tinydocy/_asset/${hex}`,
    });
    const { hex } = await store.put("d", contractImage(1), "image/png");
    const scope = { store, docId: "d" };
    const signal = new AbortController().signal;
    expect(resolver.peek(scope, hex, signal)).toBe(
      `app://tinydocy/_asset/${hex}`,
    );
    expect(await resolver.load(scope, hex, signal)).toBe(
      `app://tinydocy/_asset/${hex}`,
    );
    expect(counts().created).toBe(0);
  });

  it("renders web bytes through one object URL, peeked once warm", async () => {
    const { resolver, counts } = setup();
    const editor = fakeEditor();
    resolver.track(editor);
    const store = new MemoryBlobStore();
    const { hex } = await store.put("d", contractImage(1), "image/png");
    const scope = { store, docId: "d" };
    expect(resolver.peek(scope, hex, new AbortController().signal)).toBeNull();
    expect(await resolver.load(scope, hex, new AbortController().signal)).toBe(
      "blob:test/1",
    );
    expect(resolver.peek(scope, hex, new AbortController().signal)).toBe(
      "blob:test/1",
    );
    editor.destroy();
    expect(counts()).toEqual({ created: 1, revoked: 1 });
  });

  it("returns null for bytes that are not on this computer", async () => {
    const { resolver } = setup();
    const store = new MemoryBlobStore();
    const { hex } = await store.put("d", contractImage(1), "image/png");
    store.markMissing(hex);
    expect(
      await resolver.load(
        { store, docId: "d" },
        hex,
        new AbortController().signal,
      ),
    ).toBeNull();
  });

  it("tracks an editor once", () => {
    const { resolver, counts } = setup();
    const editor = fakeEditor();
    resolver.track(editor);
    resolver.track(editor);
    const other = fakeEditor();
    resolver.track(other);
    editor.destroy();
    other.destroy();
    expect(counts().revoked).toBe(0);
  });
});
