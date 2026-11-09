"use client";

import { Button } from "@/components/ui/button";
import { retryConnection } from "@/hooks/use-connection-state";
import { CloseIcon, CloudOffIcon } from "@/lib/icons";

/** Title on tab actions that need the server (create, close). */
export const OFFLINE_TAB_ACTION_HINT = "Reconnect to create or close tabs";

/**
 * In-flow strip under the tab bar while the collab server is unreachable.
 * Deliberately not a live region: the status strip announces transitions,
 * and a second region would announce them twice.
 */
export function OfflineBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-50 px-3 py-1.5 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
      <CloudOffIcon className="size-3.5 shrink-0" aria-hidden="true" />
      <p className="m-0 flex-1">
        You&apos;re offline. Keep this tab open: your edits stay here and sync
        when you reconnect. Others won&apos;t see them until then.
      </p>
      <Button variant="ghost" size="xs" onClick={retryConnection}>
        Try now
      </Button>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Hide offline message"
        onClick={onDismiss}
      >
        <CloseIcon />
      </Button>
    </div>
  );
}
