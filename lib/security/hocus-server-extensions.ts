import { Logger } from "@hocuspocus/extension-logger";
import { Redis } from "@hocuspocus/extension-redis";
import { Throttle } from "@hocuspocus/extension-throttle";
import type { Extension, onConnectPayload } from "@hocuspocus/server";

import { logAbuseEvent } from "@/lib/security/abuse-log";
import {
  HOCUS_LOGGER_ENABLED,
  HOCUS_REDIS_ENABLED,
  HOCUS_REDIS_HOST,
  HOCUS_REDIS_PORT,
  HOCUS_THROTTLE_BAN_MINUTES,
  HOCUS_THROTTLE_ENABLED,
  HOCUS_THROTTLE_MAX_ATTEMPTS,
  HOCUS_THROTTLE_WINDOW_SECONDS,
} from "@/lib/security/guardrail-config";

/** Throttle that reports each new ban, so the runbook's alerts can fire. */
class LoggingThrottle extends Throttle {
  override async onConnect(data: onConnectPayload): Promise<unknown> {
    const ip = data.request.headers.get("x-real-ip") ?? "";
    const wasBanned = this.isBanned(ip);
    try {
      return await super.onConnect(data);
    } catch (error) {
      if (!wasBanned) logAbuseEvent("ws_throttle_ban", { ip });
      throw error;
    }
  }
}

/**
 * One JSON line per Logger message. Document names are client-chosen, so
 * raw output would let a name forge log lines or inject terminal escapes.
 */
function logHocusMessage(...args: unknown[]): void {
  console.log(
    JSON.stringify({ type: "hocus", msg: args.map(String).join(" ") }),
  );
}

/**
 * Hocuspocus extension stack. Order matters: Throttle must be first per upstream docs.
 */
export function buildHocusServerExtensions(
  persistence: Extension,
  documentGuard: Extension,
): Extension[] {
  const extensions: Extension[] = [];

  if (HOCUS_THROTTLE_ENABLED) {
    extensions.push(
      new LoggingThrottle({
        throttle: HOCUS_THROTTLE_MAX_ATTEMPTS,
        banTime: HOCUS_THROTTLE_BAN_MINUTES,
        consideredSeconds: HOCUS_THROTTLE_WINDOW_SECONDS,
      }),
    );
  }

  if (HOCUS_LOGGER_ENABLED) {
    extensions.push(
      new Logger({
        onChange: false,
        log: logHocusMessage,
      }),
    );
  }

  if (HOCUS_REDIS_ENABLED) {
    extensions.push(
      new Redis({
        host: HOCUS_REDIS_HOST,
        port: HOCUS_REDIS_PORT,
      }),
    );
  }

  extensions.push(documentGuard, persistence);

  return extensions;
}
