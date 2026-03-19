import { Logger } from "@hocuspocus/extension-logger";
import { SQLite } from "@hocuspocus/extension-sqlite";
import { Throttle } from "@hocuspocus/extension-throttle";
import type { Extension } from "@hocuspocus/server";

import {
  HOCUS_LOGGER_ENABLED,
  HOCUS_THROTTLE_BAN_MINUTES,
  HOCUS_THROTTLE_ENABLED,
  HOCUS_THROTTLE_MAX_ATTEMPTS,
  HOCUS_THROTTLE_WINDOW_SECONDS,
} from "@/lib/security/guardrail-config";

/**
 * Hocuspocus extension stack. Order matters: Throttle must be first per upstream docs.
 */
export function buildHocusServerExtensions(databasePath: string): Extension[] {
  const extensions: Extension[] = [];

  if (HOCUS_THROTTLE_ENABLED) {
    extensions.push(
      new Throttle({
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
      }),
    );
  }

  extensions.push(new SQLite({ database: databasePath }));

  return extensions;
}
