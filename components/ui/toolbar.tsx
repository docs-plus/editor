"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";

import { useComposedRef } from "@/hooks/use-composed-ref";
import { useMenuNavigation } from "@/hooks/use-menu-navigation";
import { cn } from "@/lib/utils";

type BaseProps = React.HTMLAttributes<HTMLDivElement>;

interface ToolbarProps extends BaseProps {
  variant?: "floating" | "fixed";
}

const ITEM_SELECTOR = 'button, [role="button"], [tabindex="0"]';
const SYNC_KEYS = new Set(["ArrowLeft", "ArrowRight"]);
const ROVING_GROUP_SELECTOR = "[data-roving-group]";

/** A focused native button activates itself on Enter; the toolbar's roving
 * index can lag behind focus, so it must not swallow that key. */
function ignoreNativeEnter(event: KeyboardEvent) {
  return !(event.key === "Enter" && event.target instanceof HTMLButtonElement);
}

function ignoreRovingGroupEvents(event: KeyboardEvent) {
  return !(
    event.target instanceof Element &&
    event.target.closest(ROVING_GROUP_SELECTOR)
  );
}

function useToolbarNavigation(
  toolbarRef: React.RefObject<HTMLDivElement | null>,
) {
  const [items, setItems] = useState<HTMLElement[]>([]);
  const lastFocusRef = useRef<{ el: HTMLElement; index: number } | null>(null);

  const collectItems = useCallback(() => {
    if (!toolbarRef.current) return [];
    return Array.from(
      toolbarRef.current.querySelectorAll<HTMLElement>(ITEM_SELECTOR),
    ).filter((el) => !el.closest(ROVING_GROUP_SELECTOR));
  }, [toolbarRef]);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const repairFocus = (next: HTMLElement[]) => {
      const last = lastFocusRef.current;
      if (!last || last.el.isConnected || next.length === 0) return;
      const active = document.activeElement;
      const focusLost =
        !active ||
        active === document.body ||
        !active.isConnected ||
        active === last.el;
      lastFocusRef.current = null;
      if (!focusLost) return;
      next[Math.min(last.index, next.length - 1)]?.focus();
    };

    const updateItems = () => {
      const next = collectItems();
      setItems(next);
      repairFocus(next);
    };

    updateItems();
    const observer = new MutationObserver(updateItems);
    observer.observe(toolbar, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [collectItems, toolbarRef]);

  // Document-level capture runs before the menu hook's own listener on the
  // toolbar, so the roving index is synced to the focused item before the
  // arrow moves it.
  const syncIndexRef = useRef<(index: number) => void>(undefined);
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const syncToFocus = (event: KeyboardEvent) => {
      if (!SYNC_KEYS.has(event.key)) return;
      if (!toolbar.contains(event.target as Node)) return;
      if (!ignoreRovingGroupEvents(event)) return;
      const index = collectItems().indexOf(event.target as HTMLElement);
      if (index >= 0) syncIndexRef.current?.(index);
    };
    document.addEventListener("keydown", syncToFocus, true);
    return () => document.removeEventListener("keydown", syncToFocus, true);
  }, [collectItems, toolbarRef]);

  const { selectedIndex, setSelectedIndex } = useMenuNavigation<HTMLElement>({
    containerRef: toolbarRef,
    items,
    orientation: "horizontal",
    onSelect: (el) => el.click(),
    autoSelectFirstItem: false,
    captureTab: false,
    shouldHandle: (event) =>
      ignoreRovingGroupEvents(event) && ignoreNativeEnter(event),
  });
  syncIndexRef.current = setSelectedIndex;

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const handleFocus = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (toolbar.contains(target))
        target.setAttribute("data-focus-visible", "true");
    };

    const handleBlur = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (toolbar.contains(target))
        target.removeAttribute("data-focus-visible");
    };

    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(ROVING_GROUP_SELECTOR)) return;
      const index = collectItems().indexOf(target);
      if (index >= 0) lastFocusRef.current = { el: target, index };
    };

    const handleFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget;
      if (next instanceof Node && !toolbar.contains(next))
        lastFocusRef.current = null;
    };

    toolbar.addEventListener("focus", handleFocus, true);
    toolbar.addEventListener("blur", handleBlur, true);
    toolbar.addEventListener("focusin", handleFocusIn);
    toolbar.addEventListener("focusout", handleFocusOut);

    return () => {
      toolbar.removeEventListener("focus", handleFocus, true);
      toolbar.removeEventListener("blur", handleBlur, true);
      toolbar.removeEventListener("focusin", handleFocusIn);
      toolbar.removeEventListener("focusout", handleFocusOut);
    };
  }, [collectItems, toolbarRef]);

  useEffect(() => {
    if (selectedIndex !== undefined && items[selectedIndex]) {
      items[selectedIndex].focus();
    }
  }, [selectedIndex, items]);
}

const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(
  ({ children, className, variant = "fixed", ...props }, ref) => {
    const toolbarRef = useRef<HTMLDivElement>(null);
    const composedRef = useComposedRef(toolbarRef, ref);
    useToolbarNavigation(toolbarRef);

    return (
      <div
        ref={composedRef}
        role="toolbar"
        aria-label="Formatting"
        data-slot="toolbar"
        data-variant={variant}
        className={cn(
          "flex items-center gap-1",
          variant === "fixed" &&
            "sticky top-0 z-10 w-full min-h-11 bg-background border-b border-border px-2 overflow-x-auto overscroll-x-contain scrollbar-none",
          variant === "floating" &&
            "p-0.5 rounded-lg border border-border bg-background shadow-md outline-none overflow-hidden",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    );
  },
);
Toolbar.displayName = "Toolbar";

const ToolbarGroup = forwardRef<HTMLDivElement, BaseProps>(
  ({ children, className, ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      data-slot="toolbar-group"
      className={cn("flex items-center gap-0.5 empty:hidden", className)}
      {...props}
    >
      {children}
    </div>
  ),
);
ToolbarGroup.displayName = "ToolbarGroup";

const ToolbarSeparator = forwardRef<HTMLDivElement, BaseProps>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      aria-hidden="true"
      data-slot="toolbar-separator"
      className={cn("mx-1 h-5 w-px self-center bg-foreground/20", className)}
      {...props}
    />
  ),
);
ToolbarSeparator.displayName = "ToolbarSeparator";

export { Toolbar, ToolbarGroup, ToolbarSeparator };
