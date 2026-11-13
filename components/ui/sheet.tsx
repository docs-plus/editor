"use client";

import { Dialog as SheetPrimitive } from "@base-ui/react/dialog";
import type * as React from "react";

import { cn } from "@/lib/utils";

/**
 * A bottom sheet (shadcn `Sheet`, on Base UI `Dialog` like `dialog.tsx`):
 * modal (`aria-modal`), focus-trapped, Esc and backdrop close it, focus
 * returns on close. The caller makes the page behind it `inert`.
 * Only the bottom side, the one the phone format sheet uses.
 */
function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
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

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex items-center gap-2 px-4 pt-2", className)}
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
