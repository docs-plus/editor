"use client";

import type { HocuspocusProvider } from "@hocuspocus/provider";
import { WebSocketStatus } from "@hocuspocus/provider";
import { useCurrentEditor } from "@tiptap/react";
import throttle from "lodash.throttle";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { UserIdentityDialog } from "@/components/tiptap-ui/user-identity-dialog";
import { PencilIcon } from "@/lib/icons";
import {
  getUserIdentity,
  saveUserIdentity,
  type UserIdentity,
} from "@/lib/user-identity";
import { cn } from "@/lib/utils";

function useConnectionStatus(provider: HocuspocusProvider) {
  const [status, setStatus] = useState<WebSocketStatus>(() =>
    provider.isSynced ? WebSocketStatus.Connected : WebSocketStatus.Connecting,
  );

  useEffect(() => {
    const handler = ({ status: s }: { status: WebSocketStatus }) =>
      setStatus(s);
    provider.on("status", handler);
    return () => {
      provider.off("status", handler);
    };
  }, [provider]);

  return status;
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

interface UserIdentityButtonProps {
  provider: HocuspocusProvider;
}

export function UserIdentityButton({ provider }: UserIdentityButtonProps) {
  const { editor } = useCurrentEditor();
  const [identity, setIdentity] = useState<UserIdentity | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const status = useConnectionStatus(provider);
  const users = useOnlineUsers(editor);

  useEffect(() => {
    setIdentity(getUserIdentity());
  }, []);

  if (!identity) return null;

  const connected = status === WebSocketStatus.Connected;
  const count = users.length;

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
          "flex items-center gap-2 rounded-md px-3 py-1.5 pr-1 text-xs",
          "border border-border bg-background shadow-sm backdrop-blur-md",
          "transition-all hover:shadow-md",
        )}
        data-state={connected ? "online" : "offline"}
      >
        <div className="flex items-center gap-1.5 text-muted-foreground select-none">
          <span
            className={cn(
              "size-1.5 rounded-md shrink-0",
              connected ? "bg-emerald-500 animate-pulse" : "bg-destructive",
            )}
            aria-hidden="true"
          />
          <span className="tabular-nums whitespace-nowrap">
            {connected
              ? `${count} user${count === 1 ? "" : "s"} online`
              : "offline"}
          </span>
        </div>

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

      <UserIdentityDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        currentUser={identity}
        onSave={handleSave}
      />
    </>
  );
}

export const CollabStatusGroup = UserIdentityButton;
