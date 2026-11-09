import { afterEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above module code, so the double lives in
// vi.hoisted too.
const fake = vi.hoisted(() => {
  class FakeProvider {
    isSynced = false;
    attach = vi.fn();
    detach = vi.fn();
    destroy = vi.fn();
    private handlers = new Map<string, Set<(payload: unknown) => void>>();
    constructor() {
      fake.created.push(this);
    }
    on(event: string, handler: (payload: unknown) => void) {
      if (!this.handlers.has(event)) this.handlers.set(event, new Set());
      this.handlers.get(event)?.add(handler);
    }
    off(event: string, handler: (payload: unknown) => void) {
      this.handlers.get(event)?.delete(handler);
    }
    emit(event: string, payload: unknown) {
      for (const handler of this.handlers.get(event) ?? []) handler(payload);
    }
  }
  const fake = { FakeProvider, created: [] as FakeProvider[] };
  return fake;
});
const created = fake.created;
type FakeProvider = (typeof created)[number];

vi.mock("@hocuspocus/provider", () => ({
  HocuspocusProvider: fake.FakeProvider,
  HocuspocusProviderWebsocket: class {},
}));

import {
  acquireCollabSession,
  DOCUMENT_TOO_LARGE_REASON,
  releaseCollabSession,
} from "@/lib/collab-session";

const unique = () => `doc-${crypto.randomUUID()}`;

afterEach(() => {
  vi.useRealTimers();
  created.length = 0;
});

describe("collab sessions", () => {
  it("reuses a live session when remounted within the release delay", () => {
    vi.useFakeTimers();
    const name = unique();
    const first = acquireCollabSession(name);
    releaseCollabSession(name);
    vi.advanceTimersByTime(500);
    const second = acquireCollabSession(name);
    expect(second.provider).toBe(first.provider);
    expect(created).toHaveLength(1);
    expect(created[0]?.destroy).not.toHaveBeenCalled();
  });

  it("destroys an unused session after the delay", () => {
    vi.useFakeTimers();
    const name = unique();
    acquireCollabSession(name);
    releaseCollabSession(name);
    vi.advanceTimersByTime(1001);
    expect(created[0]?.destroy).toHaveBeenCalledOnce();
    acquireCollabSession(name);
    expect(created).toHaveLength(2);
  });

  it("stops syncing a document the server refused for size", () => {
    const session = acquireCollabSession(unique());
    const provider = created[0] as FakeProvider;
    provider.emit("close", { event: { code: 1000, reason: "" } });
    expect(provider.detach).not.toHaveBeenCalled();

    provider.emit("close", { event: { reason: DOCUMENT_TOO_LARGE_REASON } });
    provider.emit("close", { event: { reason: DOCUMENT_TOO_LARGE_REASON } });
    expect(provider.detach).toHaveBeenCalledOnce();
    expect(session.rejectedReason).toBe(DOCUMENT_TOO_LARGE_REASON);
  });
});
