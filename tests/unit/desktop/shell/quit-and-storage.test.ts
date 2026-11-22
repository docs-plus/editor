import { describe, expect, test } from "bun:test";

import type { StorageCall } from "@/desktop/main/doc-handlers";
import {
  FLUSH_BUDGET_MS,
  QuitCoordinator,
  type QuitDeps,
  WATCHDOG_MS,
} from "@/desktop/main/quit-coordinator";
import { OpenDocRegistry } from "@/desktop/main/registry";
import {
  MAX_RESTARTS_PER_MINUTE,
  StorageSupervisor,
} from "@/desktop/main/storage-supervisor";
import type { StorageClientEvents } from "@/desktop/storage/client";

/** A manual clock: timers fire only when the test advances time. */
function fakeClock() {
  let now = 0;
  let timers: Array<{ at: number; run: () => void; live: boolean }> = [];
  return {
    now: () => now,
    setTimer(ms: number, run: () => void) {
      const timer = { at: now + ms, run, live: true };
      timers.push(timer);
      return {
        cancel() {
          timer.live = false;
        },
      };
    },
    async advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = timers
          .filter((t) => t.live && t.at <= target)
          .sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        due.live = false;
        due.run();
        await Promise.resolve();
      }
      now = target;
      timers = timers.filter((t) => t.live);
      await new Promise((r) => setTimeout(r, 0));
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

function coordinator(windows: number[], shutdown = async () => "clean") {
  const clock = fakeClock();
  const requests: Array<[number, number, string]> = [];
  const exits: number[] = [];
  const marks: string[] = [];
  const deps: QuitDeps = {
    windowIds: () => windows,
    requestFlush: (w, r, reason) => requests.push([w, r, reason]),
    shutdownStorage: shutdown,
    exit: (code) => exits.push(code),
    now: clock.now,
    setTimer: clock.setTimer,
    mark: (mark) => marks.push(mark),
  };
  return { quit: new QuitCoordinator(deps), clock, requests, exits, marks };
}

describe("QuitCoordinator", () => {
  test("flushes every window, closes storage, then exits once", async () => {
    const { quit, requests, exits, marks } = coordinator([1, 2]);
    const done = quit.quit();
    await settle();
    expect(requests.map(([w, , reason]) => [w, reason])).toEqual([
      [1, "quit"],
      [2, "quit"],
    ]);
    const requestId = requests[0][1];
    quit.confirmFlushed(1, requestId);
    quit.confirmFlushed(2, requestId);
    await done;
    expect(marks).toEqual([
      "quit_start",
      "flush_done",
      "storage_closed",
      "exit",
    ]);
    expect(exits).toEqual([0]);
    expect(quit.phase).toBe("exiting");
  });

  test("a window that never answers costs the 3 s budget, not a hang", async () => {
    const { quit, clock, exits, marks } = coordinator([1]);
    const done = quit.quit();
    await settle();
    await clock.advance(FLUSH_BUDGET_MS);
    await done;
    expect(marks).toContain("flush_timeout");
    expect(exits).toEqual([0]);
  });

  test("re-entrant: a second quit request runs nothing new", async () => {
    const { quit, requests, exits } = coordinator([]);
    await Promise.all([quit.quit(), quit.quit()]);
    expect(requests).toEqual([]);
    expect(exits).toEqual([0]);
  });

  test("the watchdog exits when storage never answers", async () => {
    const { quit, clock, exits, marks } = coordinator(
      [],
      () => new Promise(() => {}),
    );
    void quit.quit();
    await settle();
    await clock.advance(WATCHDOG_MS);
    expect(marks).toContain("watchdog_exit");
    expect(exits).toEqual([0]);
  });

  test("a window closed mid-flush stops being waited for", async () => {
    const { quit, exits } = coordinator([1, 2]);
    const done = quit.quit();
    await settle();
    quit.forgetWindow(1);
    quit.forgetWindow(2);
    await done;
    expect(exits).toEqual([0]);
  });

  test("a throwing storage shutdown still exits", async () => {
    const { quit, exits } = coordinator([], async () => {
      throw new Error("boom");
    });
    await quit.quit();
    expect(exits).toEqual([0]);
  });

  test("flushWindows on close waits for that window only", async () => {
    const { quit, requests } = coordinator([1, 2]);
    const pending = quit.flushWindows([2], "close");
    await settle();
    expect(requests).toEqual([[2, requests[0][1], "close"]]);
    quit.confirmFlushed(2, requests[0][1]);
    expect(await pending).toBe(0);
  });
});

describe("StorageSupervisor", () => {
  function supervisor(now = { t: 0 }) {
    const registry = new OpenDocRegistry();
    const exits: Array<(code: number) => void> = [];
    const replayed: unknown[] = [];
    let starts = 0;
    let failStart: string | null = null;
    const sup = new StorageSupervisor({
      registry,
      now: () => now.t,
      start: async (events: StorageClientEvents) => {
        starts++;
        if (failStart) throw { code: failStart };
        exits.push((code) => events.onExit?.(code));
        const call = (async (op: string, args: unknown) => {
          if (op === "claim" && (args as { docId: string }).docId === "gone")
            throw { code: "not_found" };
          if (op === "claim") replayed.push(args);
          return op === "append" ? 1 : null;
        }) as StorageCall;
        return { call, shutdown: async () => "clean" as const };
      },
    });
    return {
      sup,
      registry,
      exits,
      replayed,
      starts: () => starts,
      failWith: (code: string) => {
        failStart = code;
      },
    };
  }

  test("calls made before ready wait for the worker", async () => {
    const { sup } = supervisor();
    const started = sup.start();
    const result = sup.call("flush", {});
    await started;
    expect(await result).toBeNull();
    expect(sup.state).toBe("ready");
  });

  test("a crash restarts the worker and replays the registry's claims", async () => {
    const { sup, registry, exits, replayed, starts } = supervisor();
    await sup.start();
    registry.claim("doc-a", 4);
    exits[0](1);
    await sup.call("flush", {});
    expect(starts()).toBe(2);
    expect(replayed).toEqual([{ docId: "doc-a", owner: "w4" }]);
  });

  test("a claim the restarted worker refuses is dropped, not fatal", async () => {
    const { sup, registry, exits, replayed } = supervisor();
    await sup.start();
    registry.claim("gone", 1);
    registry.claim("doc-b", 2);
    exits[0](1);
    expect(await sup.call("flush", {})).toBeNull();
    expect(sup.state).toBe("ready");
    expect(replayed).toEqual([{ docId: "doc-b", owner: "w2" }]);
  });

  test(`more than ${MAX_RESTARTS_PER_MINUTE} crashes a minute leaves it degraded`, async () => {
    const now = { t: 0 };
    const { sup, exits } = supervisor(now);
    await sup.start();
    for (let i = 0; i < MAX_RESTARTS_PER_MINUTE; i++) {
      exits[i](1);
      await sup.call("flush", {});
      now.t += 1000;
    }
    exits[MAX_RESTARTS_PER_MINUTE](1);
    expect(sup.state).toBe("degraded");
    await expect(sup.call("flush", {})).rejects.toMatchObject({
      code: "library_unavailable",
    });
  });

  test("restarts spread over more than a minute don't degrade", async () => {
    const now = { t: 0 };
    const { sup, exits } = supervisor(now);
    await sup.start();
    for (let i = 0; i < MAX_RESTARTS_PER_MINUTE * 2; i++) {
      exits[i](1);
      await sup.call("flush", {});
      now.t += 61_000;
    }
    expect(sup.state).toBe("ready");
  });

  test("an open error leaves it degraded with the reason", async () => {
    const { sup, failWith } = supervisor();
    failWith("locked_elsewhere");
    await sup.start();
    expect(sup.state).toBe("degraded");
    expect(sup.openError).toBe("locked_elsewhere");
  });

  test("shutdown is idempotent and refuses calls after", async () => {
    const { sup } = supervisor();
    await sup.start();
    expect(await sup.shutdown(10)).toBe("clean");
    expect(await sup.shutdown(10)).toBe("none");
    await expect(sup.call("flush", {})).rejects.toMatchObject({
      code: "library_unavailable",
    });
  });
});
