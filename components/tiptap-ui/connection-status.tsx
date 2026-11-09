"use client";

import {
  type ReactNode,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type { ConnectionState } from "@/hooks/use-connection-state";
import {
  hasUnsyncedCollabChanges,
  subscribeUnsyncedChanges,
} from "@/lib/collab-session";
import { CloudOffIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

const OFFLINE_ANNOUNCEMENT =
  "You're offline. Keep this tab open: your edits sync when you reconnect.";
const ONLINE_ANNOUNCEMENT = "Back online. Your edits are syncing.";

const noSubscription = () => () => {};
const noUnsyncedChanges = () => false;

/**
 * Whether edits are waiting for the server, watched only while offline:
 * online, every keystroke is briefly unsynced until it is acknowledged,
 * and the strip would re-render twice per keystroke for nothing.
 */
function useUnsyncedWhileOffline(offline: boolean): boolean {
  return useSyncExternalStore(
    offline ? subscribeUnsyncedChanges : noSubscription,
    offline ? hasUnsyncedCollabChanges : noUnsyncedChanges,
    noUnsyncedChanges,
  );
}

/**
 * Text for the live region: one message per offline or online transition.
 * Never peer counts, and never "connecting", so a flapping socket is quiet.
 */
function useConnectionAnnouncement(state: ConnectionState): string {
  const [message, setMessage] = useState("");
  const previous = useRef(state);
  useEffect(() => {
    const before = previous.current;
    if (state === "connecting" || state === before) return;
    previous.current = state;
    if (state === "offline") setMessage(OFFLINE_ANNOUNCEMENT);
    else if (before === "offline") setMessage(ONLINE_ANNOUNCEMENT);
  }, [state]);
  return message;
}

function connectionLabel(
  state: ConnectionState,
  count: number,
  unsynced: boolean,
): ReactNode {
  if (state === "online")
    return `${count} user${count === 1 ? "" : "s"} online`;
  if (state === "connecting") return "Reconnecting…";
  if (!unsynced) return "Offline";
  // Phones: the strip has no room, and the offline banner says it.
  return (
    <>
      Offline<span className="max-sm:hidden"> · edits not synced yet</span>
    </>
  );
}

/**
 * Connection indicator for the status strip. Amber, never destructive:
 * editing goes on while offline. It holds the app's only connection live
 * region, rendered from mount so it is registered before its text changes.
 */
export function ConnectionStatus({
  state,
  count,
}: {
  state: ConnectionState;
  count: number;
}) {
  const offline = state === "offline";
  const unsynced = useUnsyncedWhileOffline(offline);
  const announcement = useConnectionAnnouncement(state);

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 select-none",
        offline
          ? "text-amber-700 dark:text-amber-400"
          : "text-muted-foreground",
      )}
    >
      {offline ? (
        <CloudOffIcon className="size-3 shrink-0" aria-hidden="true" />
      ) : (
        <span
          className={cn(
            "size-1.5 rounded-md shrink-0 motion-safe:animate-pulse",
            state === "online" ? "bg-emerald-500" : "bg-amber-500",
          )}
          aria-hidden="true"
        />
      )}
      <span className="tabular-nums whitespace-nowrap">
        {connectionLabel(state, count, unsynced)}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
}
