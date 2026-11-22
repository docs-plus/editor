"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { RefreshCwIcon } from "@/lib/icons";
import type { ReadOnlyReason } from "@/lib/platform/doc-session";
import { useDocSession } from "@/lib/platform/doc-session-context";
import type { SchemaGuardState } from "@/lib/schema-guard";

const OUTDATED_NOTICE =
  "A newer TinyDocy is available. Reload to keep editing; your changes on this device are kept.";

const GUARD_OUTDATED: SchemaGuardState = "outdated";
const GUARD_UNREPAIRABLE: SchemaGuardState = "unrepairable";

// The sandbox's refusals, as `DocSession` reports them (`ReadOnlyReason`).
// Literals, not collab-session's constants: the editor must not import it.
const CLIENT_OUTDATED: ReadOnlyReason = "client_outdated";

const NOTICES: Record<string, string> = {
  ["document_too_large" satisfies ReadOnlyReason]:
    "This document is over the size limit, so new changes can't be saved. Copy what you need into a new tab.",
  ["document_deleted" satisfies ReadOnlyReason]:
    "This document was deleted. You're seeing your device's last copy; copy what you need into a new tab.",
  ["offline_budget" satisfies ReadOnlyReason]:
    "You've made a lot of changes offline. Editing resumes when you're back online; nothing is lost.",
  ["schema_rejected" satisfies ReadOnlyReason]:
    "The server didn't accept this document's latest changes. Your changes on this device are kept.",
  [CLIENT_OUTDATED]: OUTDATED_NOTICE,
  [GUARD_OUTDATED]: OUTDATED_NOTICE,
  [GUARD_UNREPAIRABLE]: "This document can't be edited in this version.",
};

const RELOAD_REASONS = new Set<string>([CLIENT_OUTDATED, GUARD_OUTDATED]);

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

/**
 * Saves pending edits through the open `DocSession` (the sandbox's device
 * copies on the web), then loads the newer bundle.
 */
function ReloadButton() {
  const docSession = useDocSession();
  const [reloading, setReloading] = useState(false);
  const reload = () => {
    setReloading(true);
    return reloadAfterFlush(
      () => docSession.flush(),
      () => location.reload(),
    );
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
