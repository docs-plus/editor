import { describe, expect, test } from "bun:test";

import {
  DEEP_LINK_WINDOW_MS,
  DEEP_LINK_WINDOWS,
  type DocExists,
  openDocFromLink,
} from "@/desktop/main/deep-link-open";
import { FixedWindowLimiter } from "@/desktop/main/rate-limit";
import { OpenDocRegistry } from "@/desktop/main/registry";

const DOC = "0f8fad5b-d9cb-469f-a165-70867728950e";

function setup(exists: DocExists | ((id: string) => DocExists) = "yes") {
  const clock = { t: 0 };
  const registry = new OpenDocRegistry();
  const ours = new Set<number>();
  const created: Array<{ id: number; docId: string }> = [];
  const discarded: number[] = [];
  const focused: number[] = [];
  const logs: string[] = [];
  let nextId = 10;
  const deps = {
    registry,
    isOurs: (id: number) => ours.has(id),
    focus: (id: number) => focused.push(id),
    create: (docId: string) => {
      const id = nextId++;
      ours.add(id);
      created.push({ id, docId });
      return { id };
    },
    discard: (id: number) => {
      ours.delete(id);
      discarded.push(id);
    },
    docExists: async (id: string) =>
      typeof exists === "function" ? exists(id) : exists,
    limiter: new FixedWindowLimiter(
      DEEP_LINK_WINDOWS,
      DEEP_LINK_WINDOW_MS,
      () => clock.t,
    ),
    log: (event: string) => logs.push(event),
  };
  return { deps, registry, ours, created, discarded, focused, logs, clock };
}

describe("openDocFromLink", () => {
  test("opens a window for an existing document and claims it", async () => {
    const { deps, created, registry } = setup("yes");
    expect(await openDocFromLink(DOC, deps)).toBe("opened");
    expect(created).toEqual([{ id: 10, docId: DOC }]);
    expect(registry.holder(DOC)).toBe(10);
  });

  test("a document that doesn't exist opens no window", async () => {
    const { deps, created, logs } = setup("no");
    expect(await openDocFromLink(DOC, deps)).toBe("unknown_doc");
    expect(created).toEqual([]);
    expect(logs).toEqual(["deep_link_unknown_doc"]);
  });

  test("storage that can't answer opens no window", async () => {
    const { deps, created, logs } = setup("unknown");
    expect(await openDocFromLink(DOC, deps)).toBe("unverified");
    expect(created).toEqual([]);
    expect(logs).toEqual(["deep_link_unverified"]);
  });

  test("a document another window holds focuses that window, without asking storage", async () => {
    let asked = 0;
    const { deps, registry, ours, focused, created } = setup(() => {
      asked++;
      return "yes";
    });
    ours.add(3);
    registry.claim(DOC, 3);
    expect(await openDocFromLink(DOC, deps)).toBe("focused");
    expect(focused).toEqual([3]);
    expect(created).toEqual([]);
    expect(asked).toBe(0);
  });

  test("a window that took the document while storage answered wins", async () => {
    const { deps, registry, ours, focused, created } = setup();
    deps.docExists = async () => {
      ours.add(4);
      registry.claim(DOC, 4);
      return "yes";
    };
    expect(await openDocFromLink(DOC, deps)).toBe("focused");
    expect(focused).toEqual([4]);
    expect(created).toEqual([]);
  });

  test("a claim that fails after creating the window discards it and focuses the holder", async () => {
    const { deps, registry, focused, discarded } = setup();
    const create = deps.create;
    deps.create = (docId) => {
      const window = create(docId);
      registry.claim(docId, 99);
      return window;
    };
    expect(await openDocFromLink(DOC, deps)).toBe("focused");
    expect(discarded).toEqual([10]);
    expect(focused).toEqual([99]);
  });

  test(`at most ${DEEP_LINK_WINDOWS} windows per ${DEEP_LINK_WINDOW_MS} ms from links`, async () => {
    const { deps, created, logs, clock } = setup("yes");
    const outcomes: string[] = [];
    for (let i = 0; i < DEEP_LINK_WINDOWS + 3; i++)
      outcomes.push(await openDocFromLink(crypto.randomUUID(), deps));
    expect(outcomes.filter((o) => o === "opened")).toHaveLength(
      DEEP_LINK_WINDOWS,
    );
    expect(outcomes.filter((o) => o === "throttled")).toHaveLength(3);
    expect(logs.filter((l) => l === "deep_link_throttled")).toHaveLength(1);
    clock.t += DEEP_LINK_WINDOW_MS;
    expect(await openDocFromLink(crypto.randomUUID(), deps)).toBe("opened");
    expect(created).toHaveLength(DEEP_LINK_WINDOWS + 1);
  });
});

describe("FixedWindowLimiter", () => {
  test("ok up to the limit, one first_drop, then dropped, per key and window", () => {
    const clock = { t: 0 };
    const limiter = new FixedWindowLimiter(2, 1000, () => clock.t);
    expect([1, 2, 3, 4].map(() => limiter.take("a"))).toEqual([
      "ok",
      "ok",
      "first_drop",
      "dropped",
    ]);
    expect(limiter.take("b")).toBe("ok");
    clock.t = 1000;
    expect(limiter.take("a")).toBe("ok");
    limiter.forget("a");
    expect([1, 2, 3].map(() => limiter.take("a"))).toEqual([
      "ok",
      "ok",
      "first_drop",
    ]);
  });
});
