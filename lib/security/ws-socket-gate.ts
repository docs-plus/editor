import { createSlidingWindowLimiter } from "@/lib/security/rate-limit";

export type SocketGateDecision =
  | { allowed: true }
  | { allowed: false; reason: string; status: 403 | 429 | 503 };

type SocketGateOptions = {
  socketsPerIp: number;
  maxSockets: number;
  upgradesPerMinute: number;
  /** Browser origins allowed to connect; empty allows any. */
  allowedOrigins: readonly string[];
  now?: () => number;
};

/**
 * Admission control at the WebSocket upgrade, before Hocuspocus sees the
 * socket. Per-document limits only run on auth messages, so without this a
 * client could hold open any number of silent sockets.
 */
export function createSocketGate(options: SocketGateOptions) {
  const open = new Map<string, number>();
  let total = 0;
  const upgrades = createSlidingWindowLimiter({
    limit: options.upgradesPerMinute,
    windowMs: 60_000,
    now: options.now,
  });

  return {
    admit(ip: string, origin: string | null): SocketGateDecision {
      if (
        origin &&
        options.allowedOrigins.length > 0 &&
        !options.allowedOrigins.includes(origin)
      ) {
        return { allowed: false, reason: "ws_origin_rejected", status: 403 };
      }
      if (total >= options.maxSockets) {
        return { allowed: false, reason: "ws_server_full", status: 503 };
      }
      if ((open.get(ip) ?? 0) >= options.socketsPerIp) {
        return { allowed: false, reason: "ws_sockets_per_ip", status: 429 };
      }
      if (!upgrades.check(ip).allowed) {
        return { allowed: false, reason: "ws_upgrade_rate", status: 429 };
      }
      return { allowed: true };
    },
    /** Call once the upgrade succeeded. */
    opened(ip: string): void {
      open.set(ip, (open.get(ip) ?? 0) + 1);
      total++;
    },
    closed(ip: string): void {
      const count = open.get(ip) ?? 0;
      if (count <= 1) open.delete(ip);
      else open.set(ip, count - 1);
      total = Math.max(0, total - 1);
    },
    openSockets: () => total,
  };
}
