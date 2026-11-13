"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  CLIENT_OUTDATED_REASON,
  DOCUMENT_DELETED_REASON,
  DOCUMENT_TOO_LARGE_REASON,
  flushAllLocalCopies,
  OFFLINE_BUDGET_REASON,
  SCHEMA_REJECTED_REASON,
} from "@/lib/collab-session";
import { RefreshCwIcon } from "@/lib/icons";
import type { SchemaGuardState } from "@/lib/schema-guard";

const OUTDATED_NOTICE =
  "A newer TinyDocy is available. Reload to keep editing; your changes on this device are kept.";

const GUARD_OUTDATED: SchemaGuardState = "outdated";
const GUARD_UNREPAIRABLE: SchemaGuardState = "unrepairable";

const NOTICES: Record<string, string> = {
  [DOCUMENT_TOO_LARGE_REASON]:
    "This document is over the size limit, so new changes can't be saved. Copy what you need into a new tab.",
  [DOCUMENT_DELETED_REASON]:
    "This document was deleted. You're seeing your device's last copy; copy what you need into a new tab.",
  [OFFLINE_BUDGET_REASON]:
    "You've made a lot of changes offline. Editing resumes when you're back online; nothing is lost.",
  [SCHEMA_REJECTED_REASON]:
    "The server didn't accept this document's latest changes. Your changes on this device are kept.",
  [CLIENT_OUTDATED_REASON]: OUTDATED_NOTICE,
  [GUARD_OUTDATED]: OUTDATED_NOTICE,
  [GUARD_UNREPAIRABLE]: "This document can't be edited in this version.",
};

const RELOAD_REASONS = new Set([CLIENT_OUTDATED_REASON, GUARD_OUTDATED]);

/** How long Reload waits for device copies before reloading anyway. */
const RELOAD_FLUSH_TIMEOUT_MS = 2000;

/**
 * Flushes the device copies, then reloads, after `timeoutMs` at the latest
 * and also when the flush fails: a stuck IndexedDB must not trap the user
 * on an outdated bundle.
 */
export async function reloadAfterFlush(
  flush: () => Promise<void>,
  reload: () => void,
  timeoutMs = RELOAD_FLUSH_TIMEOUT_MS,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, timeoutMs);
  });
  try {
    await Promise.race([flush(), timeout]);
  } catch (error) {
    console.warn("Saving device copies before reload failed:", error);
  } finally {
    clearTimeout(timer);
  }
  reload();
}

/** Saves pending device copies, then loads the newer bundle. */
function ReloadButton() {
  const [reloading, setReloading] = useState(false);
  const reload = () => {
    setReloading(true);
    return reloadAfterFlush(flushAllLocalCopies, () => location.reload());
  };
  return (
    <Button
      size="sm"
      variant="secondary"
      disabled={reloading}
      onClick={() => void reload()}
    >
      <RefreshCwIcon aria-hidden="true" />
      Reload
    </Button>
  );
}

/**
 * Why this document can't be edited: a server refusal (size, deleted,
 * outdated client, schema) or the schema guard (`outdated`, `unrepairable`).
 */
export function DocumentNotice({ reason }: { reason: string }) {
  return (
    <div role="alert" className="document-size-notice">
      <p>{NOTICES[reason] ?? "New changes to this document can't be saved."}</p>
      {RELOAD_REASONS.has(reason) && <ReloadButton />}
    </div>
  );
}
