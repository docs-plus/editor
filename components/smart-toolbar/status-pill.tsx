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
/** The bubble's scroll container: the plugin appends its root here. */
const SCROLL_CONTAINER = ".document-editor-wrapper";
const BUBBLE_ROOT = ":scope > [data-smart-bubble]";

const BUBBLE_PANEL = '[data-smart-bubble][data-state="open"] .st-bubble-panel';
/** `PAINTING_CLASS` (`paint-format.ts`, the lazy engine: never imported here). */
const PAINTING = ".is-painting";
const GAP = 8;

const getNoNotice = () => null;

export type PillPlacement = "desktop" | "phone";

type Box = Pick<DOMRect, "top" | "right" | "bottom" | "left">;

const overlaps = (a: Box, b: Box) =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/**
 * Where the pill goes when its place under the sticky row would cover the
 * selection bubble (near the top of the page): 8px right of the bubble,
 * level with it but never above `minTop` (8px under the sticky row, which
 * the bubble can slide under), when that fits the viewport, else 8px
 * below it. Never over the bubble, so the armed brush stays clickable.
 * `null`: no clash.
 */
export function besideBubble(
  pill: Box,
  bubble: Box | undefined,
  viewportWidth: number,
  minTop: number,
): { top: number; left: number } | null {
  if (!bubble || !overlaps(pill, bubble)) return null;
  const width = pill.right - pill.left;
  return bubble.right + GAP + width <= viewportWidth - GAP
    ? { top: Math.max(bubble.top, minTop), left: bubble.right + GAP }
    : { top: bubble.bottom + GAP, left: pill.left };
}

/**
 * Desktop: fixed 8px under the sticky row, centred over the page column,
 * beside the bubble when it would cover it (`besideBubble`). The default
 * goes on the pill first, so its own width is known, then the result: the
 * pill is right even when React sees the same style again.
 */
function desktopPosition(pill: HTMLElement): CSSProperties {
  const row = document.querySelector(STICKY_ROW)?.getBoundingClientRect();
  const column = document.querySelector(PAGE_COLUMN)?.getBoundingClientRect();
  const top = (row?.bottom ?? 0) + GAP;
  const centred: CSSProperties = {
    position: "fixed",
    top: `${top}px`,
    left: column ? `${column.left + column.width / 2}px` : "50%",
    // `translate`, not `transform`: the enter animation owns `transform`.
    translate: "-50% 0",
  };
  Object.assign(pill.style, centred);
  const moved = besideBubble(
    pill.getBoundingClientRect(),
    document.querySelector(BUBBLE_PANEL)?.getBoundingClientRect(),
    window.innerWidth,
    top,
  );
  if (!moved) return centred;
  const beside: CSSProperties = {
    position: "fixed",
    top: `${moved.top}px`,
    left: `${moved.left}px`,
    translate: "none",
  };
  Object.assign(pill.style, beside);
  return beside;
}

/**
 * Calls `measure` (at most once a frame) whenever the bubble appears,
 * moves or closes while the pill shows: the plugin appends and removes
 * its root and moves it by its inline style, the view flips `data-state`,
 * and it scrolls with the text under the fixed pill. Returns the cleanup.
 */
function followBubble(measure: () => void): () => void {
  const container = document.querySelector(SCROLL_CONTAINER);
  if (!container) return () => {};
  let frame = 0;
  const schedule = () => {
    frame ||= requestAnimationFrame(() => {
      frame = 0;
      measure();
    });
  };
  const watchRoot = () => {
    const root = container.querySelector(BUBBLE_ROOT);
    if (root) {
      observer.observe(root, { attributeFilter: ["style", "data-state"] });
    }
  };
  const observer = new MutationObserver(() => {
    watchRoot();
    schedule();
  });
  observer.observe(container, { childList: true });
  watchRoot();
  container.addEventListener("scroll", schedule, { passive: true });
  return () => {
    observer.disconnect();
    container.removeEventListener("scroll", schedule);
    cancelAnimationFrame(frame);
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
    const pill = ref.current;
    if (placement !== "desktop" || !pill) return;
    const measure = () => setPosition(desktopPosition(pill));
    measure();
    return followBubble(measure);
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
    // While Paint format is armed Esc never closes the pill on its own:
    // only Esc in the text cancels painting (and closes it), so the pill
    // stays as long as a drag would still paint (design pass §5).
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector(PAINTING)) {
        dismissNotice(notice.id);
      }
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
          // A click keeps focus (and the selection) in the editor.
          onMouseDown={(event) => event.preventDefault()}
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
 * such as Undo), stays while hovered or focused, and Esc closes it
 * (unless Paint format is armed). Desktop: mounted by the selection
 * bubble's chunk, portalled under the sticky row, beside the bubble when
 * it would cover it. Phone: inside the docked bar, beside its cells (never in a
 * masked or scrolling element), 8px above it.
 */
export function StatusPill({ placement }: { placement: PillPlacement }) {
  const notice = useSyncExternalStore(subscribeNotice, getNotice, getNoNotice);
  return notice ? (
    <Pill key={notice.id} notice={notice} placement={placement} />
  ) : null;
}
