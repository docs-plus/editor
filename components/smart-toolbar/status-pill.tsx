"use client";

import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";

import { Button } from "@/components/ui/button";
import {
  dismissNotice,
  getNotice,
  type Notice,
  subscribeNotice,
} from "@/lib/announce";
import { CheckIcon, InfoIcon } from "@/lib/icons";
import { cn } from "@/lib/utils";

const PILL_MS = 2500;
const ACTION_PILL_MS = 5000;
const STICKY_ROW = '.document-editor-wrapper > [data-slot="toolbar"]';
const PAGE_COLUMN = ".document-editor-content";

const getNoNotice = () => null;

export type PillPlacement = "desktop" | "phone";

/**
 * Desktop: fixed 8px under the sticky row, centred over the page column,
 * measured when the notice shows (it lasts seconds).
 */
function desktopPosition(): CSSProperties {
  const row = document.querySelector(STICKY_ROW)?.getBoundingClientRect();
  const column = document.querySelector(PAGE_COLUMN)?.getBoundingClientRect();
  return {
    position: "fixed",
    top: (row?.bottom ?? 0) + 8,
    left: column ? column.left + column.width / 2 : "50%",
    // `translate`, not `transform`: the enter animation owns `transform`.
    translate: "-50% 0",
  };
}

function Pill({
  notice,
  placement,
}: {
  notice: Notice;
  placement: PillPlacement;
}) {
  // Hovered or focused: stays open (WCAG 1.4.13).
  const [held, setHeld] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const hold = () => setHeld(true);
    const release = () => setHeld(false);
    const events = [
      ["pointerenter", hold],
      ["pointerleave", release],
      ["focusin", hold],
      ["focusout", release],
    ] as const;
    for (const [type, listener] of events) el.addEventListener(type, listener);
    return () => {
      for (const [type, listener] of events) {
        el.removeEventListener(type, listener);
      }
    };
  }, []);
  const [position, setPosition] = useState<CSSProperties>();
  useLayoutEffect(() => {
    if (placement === "desktop") setPosition(desktopPosition());
  }, [placement]);
  useEffect(() => {
    if (held) return;
    const timer = setTimeout(
      () => dismissNotice(notice.id),
      notice.action ? ACTION_PILL_MS : PILL_MS,
    );
    return () => clearTimeout(timer);
  }, [notice, held]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismissNotice(notice.id);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [notice]);
  const { action } = notice;
  const Icon = notice.done ? CheckIcon : InfoIcon;
  const pill = (
    // Not a live region: `announce()` already spoke this text, so the
    // pill's text is hidden from assistive tech; its action stays
    // reachable. Never takes focus; not a toolbar stop on the phone.
    <div
      ref={ref}
      data-status-pill={placement}
      data-roving-skip=""
      style={position}
      className={cn(
        "pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-md",
        "animate-in fade-in-0 slide-in-from-bottom-1 duration-150 motion-reduce:animate-none",
        "forced-colors:border-[CanvasText] forced-colors:bg-[Canvas] forced-colors:text-[CanvasText]",
        placement === "phone"
          ? "absolute inset-x-2 bottom-[calc(100%+8px)] z-50"
          : "z-50 max-w-[min(32rem,calc(100vw-2rem))]",
        placement === "desktop" && !position && "invisible",
      )}
    >
      <Icon
        className="size-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
      <span className="min-w-0 flex-1" aria-hidden="true">
        {notice.text}
      </span>
      {action ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          aria-label={`${action.label}: ${notice.text}`}
          onClick={() => {
            dismissNotice(notice.id);
            action.run();
          }}
        >
          {action.label}
        </Button>
      ) : null}
    </div>
  );
  return placement === "phone" ? pill : createPortal(pill, document.body);
}

/**
 * The status pill (design pass §5): one per editor, the sighted twin of
 * `announce()`, which feeds it. Closes after 2.5 s (5 s with an action
 * such as Undo), stays while hovered or focused, and Esc closes it.
 * Desktop: mounted by the selection bubble's chunk, portalled under the
 * sticky row. Phone: inside the docked bar, beside its cells (never in a
 * masked or scrolling element), 8px above it.
 */
export function StatusPill({ placement }: { placement: PillPlacement }) {
  const notice = useSyncExternalStore(subscribeNotice, getNotice, getNoNotice);
  return notice ? (
    <Pill key={notice.id} notice={notice} placement={placement} />
  ) : null;
}
