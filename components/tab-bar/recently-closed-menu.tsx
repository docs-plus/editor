"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { dismissNotice, getNotice, subscribeNotice } from "@/lib/announce";
import {
  type ClosedDocumentsList,
  fetchClosedDocuments,
  formatClosedAgo,
} from "@/lib/closed-tabs-api";
import type { RestorableTab } from "@/lib/tab-restore";

type ListState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; list: ClosedDocumentsList; nowMs: number };

export interface RecentlyClosedMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The tab bar's History button: the menu opens below it and returns focus to it. */
  anchorRef: RefObject<HTMLButtonElement | null>;
  onRestore: (tabs: readonly RestorableTab[]) => void;
}

/** The list loads each time the menu opens, so it never shows stale closes. */
function useClosedList(open: boolean): ListState {
  const [state, setState] = useState<ListState>({ status: "loading" });
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setState({ status: "loading" });
    fetchClosedDocuments(controller.signal).then((list) => {
      if (controller.signal.aborted) return;
      setState(
        list
          ? { status: "ready", list, nowMs: Date.now() }
          : { status: "error" },
      );
    });
    return () => controller.abort();
  }, [open]);
  return state;
}

/**
 * The menu and the status pill never show together (they can overlap at
 * tablet widths): opening the menu dismisses the pill, and a new pill
 * closes the menu.
 */
function useNoPillOverlap(open: boolean, close: () => void): void {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!open) return;
    dismissNotice();
    return subscribeNotice(() => {
      if (getNotice()) closeRef.current();
    });
  }, [open]);
}

function Notice({ children }: { children: string }) {
  return <DropdownMenuItem disabled>{children}</DropdownMenuItem>;
}

function ClosedItems({
  state,
  onRestore,
}: {
  state: ListState;
  onRestore: RecentlyClosedMenuProps["onRestore"];
}) {
  if (state.status === "loading") return <Notice>Loading…</Notice>;
  if (state.status === "error") {
    return <Notice>{"Couldn't load. Check your connection."}</Notice>;
  }
  const { list, nowMs } = state;
  if (list.disabled) {
    return <Notice>Recently closed is turned off on this server.</Notice>;
  }
  if (list.documents.length === 0) {
    return <Notice>Nothing closed recently</Notice>;
  }
  return list.documents.map((doc) => (
    <DropdownMenuItem
      key={doc.id}
      onClick={() => onRestore([{ id: doc.id, title: doc.title }])}
    >
      <span className="min-w-0 flex-1 truncate">{doc.title || "Untitled"}</span>
      <span className="shrink-0 text-xs text-muted-foreground">
        {formatClosedAgo(doc.closedAt, nowMs)}
      </span>
    </DropdownMenuItem>
  ));
}

/**
 * Recently closed (lazy chunk): tabs closed from this tab list in the last
 * `retentionDays`, newest first. Picking one restores it at the end.
 */
export function RecentlyClosedMenu({
  open,
  onOpenChange,
  anchorRef,
  onRestore,
}: RecentlyClosedMenuProps) {
  const state = useClosedList(open);
  useNoPillOverlap(open, () => onOpenChange(false));
  const showFooter = state.status === "ready" && !state.list.disabled;
  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next, details) => {
        // A press on the History button toggles the menu itself.
        const target = details.event?.target;
        if (
          !next &&
          target instanceof Node &&
          anchorRef.current?.contains(target)
        ) {
          return;
        }
        onOpenChange(next);
      }}
    >
      <DropdownMenuContent
        anchor={anchorRef}
        finalFocus={anchorRef}
        align="end"
        className="w-72"
        aria-label="Recently closed"
      >
        <DropdownMenuGroup>
          <DropdownMenuLabel>Recently closed</DropdownMenuLabel>
          <ClosedItems state={state} onRestore={onRestore} />
        </DropdownMenuGroup>
        {showFooter ? (
          <>
            <DropdownMenuSeparator />
            <p className="px-1.5 py-1 text-xs text-muted-foreground">
              Closed tabs are kept for {state.list.retentionDays} days. Anyone
              using this sandbox can see and restore them.
            </p>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
