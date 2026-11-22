import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  mock,
  vi,
} from "bun:test";

import {
  createIconRefresher,
  linkIconSignature,
} from "@/lib/links/icon-refresh";
import type { LinkIndexSnapshot } from "@/lib/links/resolve";
import type { DocumentEntry } from "@/lib/platform/document-index";

const A = "a".repeat(32);
const B = "b".repeat(32);

const doc = (
  id: string,
  linkKey?: string,
  extra: Partial<DocumentEntry> = {},
) => ({ id, title: id, createdAt: 0, linkKey, ...extra }) as DocumentEntry;

/** A stand-in index: `emit` swaps the snapshot and notifies, like a change. */
function fakeIndex(initial: LinkIndexSnapshot) {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => snapshot,
    subscribe: mock((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    emit(next: LinkIndexSnapshot = snapshot) {
      snapshot = next;
      for (const listener of listeners) listener();
    },
    listenerCount: () => listeners.size,
  };
}

const BASE: LinkIndexSnapshot = {
  items: [doc("d-a", A), doc("d-b", B), doc("d-plain")],
  trashed: [],
};

let dispose: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  dispose?.();
  dispose = null;
  vi.useRealTimers();
});

function setup(initial = BASE, delayMs?: number) {
  const index = fakeIndex(initial);
  const refresh = mock(() => {});
  const refresher = createIconRefresher({
    subscribe: index.subscribe,
    getSnapshot: index.getSnapshot,
    refresh,
    delayMs,
  });
  dispose = refresher.dispose;
  return { index, refresh, refresher };
}

describe("linkIconSignature", () => {
  it("ignores order, titles, folders, pins and openedAt", () => {
    const moved: LinkIndexSnapshot = {
      items: [
        doc("d-b", B, { title: "Renamed", folderId: "f", pinKey: "a0" }),
        doc("d-a", A, { openedAt: 5 }),
      ],
      folders: [{ id: "f", name: "F", parentId: null, createdAt: 0 }],
    };
    expect(linkIconSignature(moved)).toBe(linkIconSignature(BASE));
  });

  it("changes when a key comes or goes, or a document is trashed", () => {
    const base = linkIconSignature(BASE);
    expect(linkIconSignature({ items: [doc("d-a", A)] })).not.toBe(base);
    expect(
      linkIconSignature({ items: [doc("d-a", A)], trashed: [doc("d-b", B)] }),
    ).not.toBe(base);
  });
});

describe("createIconRefresher (search-linking §4.6)", () => {
  it("redraws once, debounced, when a document is trashed", () => {
    const { index, refresh } = setup();
    index.emit({ items: [doc("d-a", A)], trashed: [doc("d-b", B)] });
    index.emit();
    vi.advanceTimersByTime(99);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("each event restarts the delay", () => {
    const { index, refresh } = setup();
    index.emit({ items: [doc("d-a", A)] });
    vi.advanceTimersByTime(80);
    index.emit();
    vi.advanceTimersByTime(80);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("redraws when a link key appears or disappears", () => {
    const { index, refresh } = setup();
    index.emit({ ...BASE, items: [...BASE.items, doc("d-c", "c".repeat(32))] });
    vi.advanceTimersByTime(100);
    expect(refresh).toHaveBeenCalledTimes(1);
    index.emit(BASE);
    vi.advanceTimersByTime(100);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("never redraws for renames, moves, pins or openedAt", () => {
    const { index, refresh } = setup();
    index.emit({
      items: [
        doc("d-b", B, { title: "Renamed", folderId: "f", pinKey: "a0" }),
        doc("d-a", A, { openedAt: 9 }),
        doc("d-plain"),
      ],
      trashed: [],
    });
    vi.advanceTimersByTime(500);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("compares against the state it started from", () => {
    const { index, refresh } = setup();
    // An event with nothing new (a reload, say) draws nothing.
    index.emit({ ...BASE });
    vi.advanceTimersByTime(100);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("takes its delay from delayMs", () => {
    const { index, refresh } = setup(BASE, 10);
    index.emit({ items: [] });
    vi.advanceTimersByTime(10);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("stops on dispose, dropping a pending redraw", () => {
    const { index, refresh, refresher } = setup();
    index.emit({ items: [] });
    refresher.dispose();
    vi.advanceTimersByTime(500);
    expect(refresh).not.toHaveBeenCalled();
    expect(index.listenerCount()).toBe(0);
  });
});
