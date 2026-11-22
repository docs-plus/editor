/**
 * Keeps the storage worker running (desktop architecture §6.3):
 * - started once, in parallel with the first window; calls made before it
 *   is ready wait for it;
 * - restarted after a crash, at most 3 times a minute, and the registry's
 *   claims are replayed with `claim` before new calls go through;
 * - a 4th crash within a minute, or an open that fails, leaves it
 *   `degraded`: every call answers `library_unavailable` (read-only UI).
 *
 * Electron-free: `start` is `StorageClient.start` bound to the worker path.
 */
import type { StorageClientEvents } from "../storage/client";
import type { StorageOp, StorageOps } from "../storage/protocol";
import type { StorageCall } from "./doc-handlers";
import { ownerOf } from "./doc-handlers";
import type { OpenDocRegistry } from "./registry";

export type StorageClientLike = {
  call: StorageCall;
  shutdown(timeoutMs?: number): Promise<"clean" | "terminated">;
};

export type SupervisorState = "starting" | "ready" | "degraded" | "closed";

export type StorageSupervisorDeps = {
  start: (events: StorageClientEvents) => Promise<StorageClientLike>;
  registry: OpenDocRegistry;
  now?: () => number;
  /** Diagnostics: codes only. */
  log?: (event: string, fields?: Record<string, number | string>) => void;
  onIndexChanged?: StorageClientEvents["onIndexChanged"];
};

export const MAX_RESTARTS_PER_MINUTE = 3;

class Unavailable extends Error {
  readonly code = "library_unavailable";
  readonly retryable = true;
}

export class StorageSupervisor {
  state: SupervisorState = "starting";
  /** The open error (`locked_elsewhere`, `cloud_folder`…) when degraded at start. */
  openError: string | null = null;
  private client: StorageClientLike | null = null;
  private ready: Promise<void> = Promise.resolve();
  private readonly restarts: number[] = [];
  private readonly now: () => number;

  constructor(private readonly deps: StorageSupervisorDeps) {
    this.now = deps.now ?? (() => Date.now());
  }

  /** Starts the worker; resolves once it is ready or degraded. */
  start(): Promise<void> {
    this.ready = this.spawn(false);
    return this.ready;
  }

  private async spawn(replay: boolean): Promise<void> {
    this.state = "starting";
    try {
      const client = await this.deps.start({
        onIndexChanged: this.deps.onIndexChanged,
        onExit: (code) => this.onCrash(code),
      });
      if (replay) await this.replayClaims(client);
      this.client = client;
      this.state = "ready";
      this.deps.log?.("storage_ready", { replayed: replay ? 1 : 0 });
    } catch (error) {
      this.client = null;
      this.state = "degraded";
      this.openError = String(
        (error as { code?: unknown } | null)?.code ?? "io_error",
      );
      this.deps.log?.("storage_degraded", { reason: this.openError });
    }
  }

  /**
   * Replays the registry into a restarted worker, one claim at a time. A
   * claim the worker refuses (a deep link to a document that doesn't
   * exist, or one purged meanwhile) is dropped from the worker's side and
   * logged; it never takes the library down.
   */
  private async replayClaims(client: StorageClientLike): Promise<void> {
    let refused = 0;
    for (const { docId, windowId } of this.deps.registry.entries()) {
      try {
        await client.call("claim", { docId, owner: ownerOf(windowId) });
      } catch {
        refused++;
      }
    }
    if (refused > 0) this.deps.log?.("storage_claims_refused", { refused });
  }

  private onCrash(code: number): void {
    if (this.state === "closed") return;
    this.client = null;
    const now = this.now();
    while (this.restarts.length > 0 && now - this.restarts[0] > 60_000)
      this.restarts.shift();
    this.deps.log?.("storage_crashed", { exitCode: code });
    if (this.restarts.length >= MAX_RESTARTS_PER_MINUTE) {
      this.state = "degraded";
      this.openError = "crash_loop";
      this.deps.log?.("storage_degraded", { reason: "crash_loop" });
      return;
    }
    this.restarts.push(now);
    this.ready = this.spawn(true);
  }

  /** A `StorageCall` that waits for a (re)start and refuses when degraded. */
  readonly call: StorageCall = async <K extends StorageOp>(
    op: K,
    args: StorageOps[K]["args"],
  ): Promise<StorageOps[K]["result"]> => {
    await this.ready;
    if (!this.client) throw new Unavailable("the library is unavailable");
    return this.client.call(op, args);
  };

  /** The quit flush's last step. Idempotent. */
  async shutdown(timeoutMs = 2000): Promise<"clean" | "terminated" | "none"> {
    if (this.state === "closed") return "none";
    // A worker still opening is waited for, within the same budget.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      this.ready,
      new Promise((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    this.state = "closed";
    const client = this.client;
    this.client = null;
    return client ? client.shutdown(timeoutMs) : "none";
  }
}
