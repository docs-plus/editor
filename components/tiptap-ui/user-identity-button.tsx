"use client";

import { useCurrentEditor } from "@tiptap/react";
import throttle from "lodash.throttle";
import Link from "next/link";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { InstallAppButton } from "@/components/pwa";
import { ConnectionStatus } from "@/components/tiptap-ui/connection-status";
import { UserIdentityDialog } from "@/components/tiptap-ui/user-identity-dialog";
import { buttonVariants } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConnectionState } from "@/hooks/use-connection-state";
import {
  type AnalyticsEventMap,
  bucketPeers,
  PEERS_BUCKETS,
  trackEvent,
} from "@/lib/analytics";
import { DISCORD_INVITE_URL, GITHUB_REPO_URL } from "@/lib/constants";
import { DiscordIcon, GithubIcon, PencilIcon } from "@/lib/icons";
import {
  getUserIdentity,
  saveUserIdentity,
  type UserIdentity,
} from "@/lib/user-identity";
import { cn } from "@/lib/utils";

const statusCardClass = cn(
  "rounded-md border border-border bg-background/95 shadow-sm backdrop-blur-md",
  "transition-all hover:shadow-md",
);

const communityIconLinkClass = cn(
  buttonVariants({ variant: "ghost", size: "icon-sm" }),
  "text-muted-foreground",
);

function CommunityIconLink({
  href,
  ariaLabel,
  tooltip,
  analyticsTarget,
  children,
}: {
  href: string;
  ariaLabel: string;
  tooltip: string;
  analyticsTarget: AnalyticsEventMap["outbound_click"]["target"];
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className={communityIconLinkClass}
            aria-label={ariaLabel}
            onClick={() =>
              trackEvent("outbound_click", { target: analyticsTarget })
            }
          >
            {children}
          </a>
        }
      />
      <TooltipContent side="top" sideOffset={6}>
        {tooltip}
      </TooltipContent>
    </Tooltip>
  );
}

function useOnlineUsers(editor: ReturnType<typeof useCurrentEditor>["editor"]) {
  const [users, setUsers] = useState<{ name?: string; color?: string }[]>([]);
  const prevJsonRef = useRef("");

  const sync = useCallback(() => {
    if (!editor) return;
    const raw = editor.storage.collaborationCaret?.users as
      | { name?: string; color?: string }[]
      | undefined;
    const list = raw ?? [];
    const json = JSON.stringify(list);
    if (json !== prevJsonRef.current) {
      prevJsonRef.current = json;
      setUsers(list);
    }
  }, [editor]);

  const throttledSync = useMemo(() => throttle(sync, 200), [sync]);

  useEffect(() => {
    if (!editor) return;
    sync();
    editor.on("transaction", throttledSync);
    const interval = setInterval(sync, 3000);
    return () => {
      editor.off("transaction", throttledSync);
      throttledSync.cancel();
      clearInterval(interval);
    };
  }, [editor, sync, throttledSync]);

  return users;
}

/** Reports the peak peer bucket per document view: at most 5 events. */
function useTrackPeakPeers(count: number, connected: boolean): void {
  const peakRankRef = useRef(-1);
  useEffect(() => {
    if (!connected || count < 1) return;
    const bucket = bucketPeers(count);
    const rank = PEERS_BUCKETS.indexOf(bucket);
    if (rank <= peakRankRef.current) return;
    peakRankRef.current = rank;
    trackEvent("collab_peers", { peers_bucket: bucket });
  }, [connected, count]);
}

export function UserIdentityButton() {
  const { editor } = useCurrentEditor();
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const connection = useConnectionState();
  const users = useOnlineUsers(editor);

  const connected = connection === "online";
  const count = users.length;
  useTrackPeakPeers(count, connected);

  useEffect(() => {
    setIdentity(getUserIdentity());
  }, []);

  if (!identity) return null;

  const handleSave = (next: UserIdentity) => {
    saveUserIdentity(next);
    setIdentity(next);
    editor?.commands.updateUser(next);
  };

  return (
    <>
      <div
        className={cn(
          "fixed bottom-4 right-4 z-50",
          "flex items-center gap-4 p-1 text-xs",
        )}
        data-state={connection}
        data-collab-status=""
      >
        <div
          className={cn(
            "flex min-w-0 items-center gap-2 px-2 py-2",
            statusCardClass,
          )}
        >
          <ConnectionStatus state={connection} count={count} />

          <span className="text-border/60" aria-hidden="true">
            ·
          </span>

          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className={cn(
              "group flex items-center gap-1 rounded-sm px-1 py-0.5 -my-0.5 transition-colors",
              "hover:bg-foreground/5 active:bg-foreground/10",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            )}
            aria-label={`Edit identity: ${identity.name}`}
          >
            <span
              className="size-2.5 rounded-full shrink-0 ring-1 ring-foreground/10"
              style={{ backgroundColor: identity.color }}
              aria-hidden="true"
            />
            <span className="max-w-40 truncate font-medium text-foreground/80">
              {identity.name}
            </span>
            <PencilIcon className="size-2.5 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors" />
          </button>
        </div>

        <div
          className={cn(
            "flex shrink-0 items-center gap-1 px-1 py-0.5",
            statusCardClass,
          )}
        >
          <InstallAppButton />
          <CommunityIconLink
            href={DISCORD_INVITE_URL}
            ariaLabel="Discord community"
            tooltip="Join the Discord community"
            analyticsTarget="discord"
          >
            <DiscordIcon />
          </CommunityIconLink>
          <CommunityIconLink
            href={GITHUB_REPO_URL}
            ariaLabel="Source on GitHub"
            tooltip="View source on GitHub"
            analyticsTarget="github"
          >
            <GithubIcon />
          </CommunityIconLink>
          <Link
            href="/privacy"
            className="px-1.5 text-muted-foreground hover:text-foreground hover:underline underline-offset-2"
          >
            Privacy
          </Link>
        </div>
      </div>

      <UserIdentityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentUser={identity}
        onSave={handleSave}
      />
    </>
  );
}

export { UserIdentityButton as CollabStatusGroup };
