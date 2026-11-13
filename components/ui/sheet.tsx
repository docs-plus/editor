"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A bottom sheet (shadcn `Sheet`, on Base UI `Dialog` like `dialog.tsx`):
 * modal (`aria-modal`), focus-trapped, Esc and backdrop close it, focus
 * returns on close. The caller makes the page behind it `inert`.
 * Only the bottom side, the one the phone format sheet uses. A downward
 * swipe on the header closes it too (`SheetHeader`).
 */
type SheetActions = React.RefObject<SheetPrimitive.Root.Actions | null>;

const SheetActionsContext = React.createContext<SheetActions | null>(null);

function Sheet({ actionsRef, ...props }: SheetPrimitive.Root.Props) {
  const ownActions = React.useRef<SheetPrimitive.Root.Actions | null>(null);
  const actions = actionsRef ?? ownActions;
  return (
    <SheetActionsContext value={actions}>
      <SheetPrimitive.Root data-slot="sheet" actionsRef={actions} {...props} />
    </SheetActionsContext>
  );
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

const TABBABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Tab and Shift+Tab wrap inside the sheet. Base UI's focus guards sit
 * outside the portalled popup and let Tab reach them and `body`.
 */
function wrapTab(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key !== "Tab" || event.defaultPrevented) return;
  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(TABBABLE),
  ).filter(
    (el) =>
      el.tabIndex >= 0 && !el.matches(":disabled") && el.checkVisibility(),
  );
  if (items.length === 0) return;
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  const edge = event.shiftKey ? first : last;
  if (active !== edge && event.currentTarget.contains(active)) return;
  event.preventDefault();
  (event.shiftKey ? last : first).focus();
}

function SheetContent({
  className,
  children,
  onKeyDown,
  ...props
}: SheetPrimitive.Popup.Props) {
  return (
    <SheetPrimitive.Portal data-slot="sheet-portal">
      <SheetPrimitive.Backdrop
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/20 duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0 motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none"
      />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        aria-modal="true"
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-xl border-t border-border bg-background text-sm text-foreground shadow-lg outline-none duration-150 data-open:animate-in data-open:slide-in-from-bottom data-closed:animate-out data-closed:slide-out-to-bottom motion-reduce:data-open:animate-none motion-reduce:data-closed:animate-none",
          className,
        )}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          wrapTab(event);
        }}
        {...props}
      >
        {children}
      </SheetPrimitive.Popup>
    </SheetPrimitive.Portal>
  );
}

/** Drag (px) past which letting go closes the sheet. */
const SWIPE_CLOSE_DISTANCE = 80;
/** A downward flick this fast (px/ms) closes it from a shorter drag. */
const SWIPE_CLOSE_VELOCITY = 0.5;
/** Movement before a press becomes a drag, so a tap stays a tap. */
const SWIPE_SLOP = 6;
const INTERACTIVE = "button, a, input, select, textarea";

interface SwipeState {
  pointerId: number;
  startY: number;
  lastY: number;
  lastTime: number;
  velocity: number;
  dragging: boolean;
  popup: HTMLElement;
}

const prefersReducedMotion = () =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * Swipe down to close (pointer or touch, from the header but not its
 * buttons): the sheet follows the finger, then closes past
 * `SWIPE_CLOSE_DISTANCE` (or on a quick flick) and otherwise snaps back.
 * It closes through Base UI, like Done, Esc and the backdrop, so focus
 * returns and the caller's `onOpenChange` runs. With reduced motion the
 * snap back and the close are instant.
 */
function useSwipeToClose() {
  const actions = React.useContext(SheetActionsContext);
  const swipe = React.useRef<SwipeState | null>(null);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    if (!(event.target instanceof Element)) return;
    if (event.target.closest(INTERACTIVE)) return;
    const popup = event.currentTarget.closest<HTMLElement>(
      '[data-slot="sheet-content"]',
    );
    if (!popup) return;
    swipe.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastTime: event.timeStamp,
      velocity: 0,
      dragging: false,
      popup,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = swipe.current;
    if (!state || event.pointerId !== state.pointerId) return;
    const distance = Math.max(0, event.clientY - state.startY);
    if (!state.dragging) {
      if (distance < SWIPE_SLOP) return;
      state.dragging = true;
      // Captured only once dragging, so a press on the header stays a click.
      event.currentTarget.setPointerCapture(event.pointerId);
      state.popup.style.transition = "none";
    }
    const elapsed = event.timeStamp - state.lastTime;
    if (elapsed > 0) state.velocity = (event.clientY - state.lastY) / elapsed;
    state.lastY = event.clientY;
    state.lastTime = event.timeStamp;
    state.popup.style.transform = `translateY(${distance}px)`;
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    const state = swipe.current;
    if (!state || event.pointerId !== state.pointerId) return;
    swipe.current = null;
    if (!state.dragging) return;
    const distance = Math.max(0, state.lastY - state.startY);
    const close =
      event.type === "pointerup" &&
      (distance >= SWIPE_CLOSE_DISTANCE ||
        (state.velocity >= SWIPE_CLOSE_VELOCITY && distance > SWIPE_SLOP * 2));
    const reduce = prefersReducedMotion();
    const { style } = state.popup;
    style.transition = reduce ? "none" : "transform 150ms ease-out";
    if (!close) {
      style.transform = "";
      return;
    }
    // Leaves from where the finger let go: no slide-out from the top.
    style.animation = "none";
    if (!reduce) style.transform = "translateY(100%)";
    actions?.current?.close();
  };

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp: onPointerEnd,
    onPointerCancel: onPointerEnd,
  };
}

/** The sheet's header and its drag handle (swipe down to close). */
function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  const swipe = useSwipeToClose();
  return (
    <div
      data-slot="sheet-header"
      className={cn(
        "relative flex touch-none items-center gap-2 px-4 pt-3 select-none before:absolute before:top-1.5 before:left-1/2 before:h-1 before:w-9 before:-translate-x-1/2 before:rounded-full before:bg-muted-foreground/40",
        className,
      )}
      {...swipe}
      {...props}
    />
  );
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-base leading-none font-medium", className)}
      {...props}
    />
  );
}

export {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
};
