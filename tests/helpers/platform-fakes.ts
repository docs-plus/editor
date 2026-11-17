/**
 * Fakes for the platform ports (desktop architecture §11). `MemoryDocStore`
 * itself lives in `lib/platform/` because the dev bridge uses it too.
 */
import type { Clock } from "@/lib/platform/batcher";

type Timer = { id: number; at: number; fn: () => void };

/** Lets promise chains (store calls, acks) settle. */
export async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise((r) => setTimeout(r, 0));
}

/**
 * A clock that moves only when told. `advance` fires due timers in time
 * order and lets promises settle after each one, so an ack scheduled by a
 * timer lands before the next timer runs.
 */
export class FakeClock implements Clock {
  private time = 0;
  private nextId = 1;
  private timers: Timer[] = [];

  now(): number {
    return this.time;
  }

  setTimeout(fn: () => void, ms: number): unknown {
    const timer = { id: this.nextId++, at: this.time + Math.max(0, ms), fn };
    this.timers.push(timer);
    return timer.id;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((timer) => timer.id !== handle);
  }

  /** Timers still waiting. */
  get pending(): number {
    return this.timers.length;
  }

  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    await settle();
    for (;;) {
      const due = this.timers
        .filter((timer) => timer.at <= end)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.timers = this.timers.filter((timer) => timer !== due);
      this.time = due.at;
      due.fn();
      await settle();
    }
    this.time = end;
  }
}
