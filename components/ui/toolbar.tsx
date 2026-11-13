"use client";

import { forwardRef, useEffect, useRef } from "react";

import { useComposedRef } from "@/hooks/use-composed-ref";
import { cn } from "@/lib/utils";

type BaseProps = React.HTMLAttributes<HTMLDivElement>;

interface ToolbarProps extends BaseProps {
  variant?: "floating" | "fixed";
  /**
   * Esc on a toolbar item (not inside an open menu, which handles its own
   * Esc in a portal). The editor shell returns focus to the document with
   * its selection.
   */
  onEscape?: () => void;
}

/**
 * Roving items. `data-toolbar-item` is stamped on every collected item, so
 * a non-button opted in by `[tabindex="0"]` stays an item after the toolbar
 * sets it to `-1`.
 */
const ITEM_SELECTOR =
  'button, [role="button"], [tabindex="0"], [data-toolbar-item]';
const ROVING_GROUP_SELECTOR = "[data-roving-group]";
const SKIP_SELECTOR = "[data-roving-skip], [hidden]";
const MOVES: Record<string, (current: number, last: number) => number> = {
  ArrowRight: (current) => current + 1,
  ArrowLeft: (current) => current - 1,
  Home: () => 0,
  End: (_current, last) => last,
};

function isVisible(el: HTMLElement): boolean {
  if (el.closest(SKIP_SELECTOR)) return false;
  return typeof el.checkVisibility === "function" ? el.checkVisibility() : true;
}

/** The toolbar's roving items in DOM order, collected now (never cached). */
export function collectToolbarItems(toolbar: HTMLElement): HTMLElement[] {
  return Array.from(
    toolbar.querySelectorAll<HTMLElement>(ITEM_SELECTOR),
  ).filter((el) => !el.closest(ROVING_GROUP_SELECTOR) && isVisible(el));
}

function setTabIndex(el: HTMLElement, value: "0" | "-1") {
  if (el.getAttribute("tabindex") !== value) el.setAttribute("tabindex", value);
  if (!el.hasAttribute("data-toolbar-item")) {
    el.setAttribute("data-toolbar-item", "");
  }
}

/**
 * Focuses the toolbar's tab stop, or its first item. Returns whether
 * something in the toolbar took focus (Alt+F10).
 */
export function focusRovingItem(toolbar: HTMLElement | null): boolean {
  if (!toolbar) return false;
  const items = collectToolbarItems(toolbar);
  const stop =
    items.find((el) => el.getAttribute("tabindex") === "0") ?? items[0];
  stop?.focus();
  return Boolean(stop && toolbar.contains(document.activeElement));
}

/**
 * One Tab stop with a DOM-owned roving tabindex (WAI-ARIA toolbar): the
 * toolbar writes `tabindex` on every item (one `0`, the rest `-1`), the
 * stop follows focus, and arrow keys move from the focused item, computed
 * at keydown (never a stale index). A removed focused item passes focus to
 * its neighbour at the same index.
 */
function useRovingTabindex(
  toolbarRef: React.RefObject<HTMLDivElement | null>,
  onEscapeRef: React.RefObject<(() => void) | undefined>,
) {
  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    let stop: HTMLElement | null = null;
    let stopIndex = 0;
    let lastFocus: { el: HTMLElement; index: number } | null = null;

    const normalize = () => {
      const items = collectToolbarItems(toolbar);
      if (items.length === 0) return items;
      if (!stop || !items.includes(stop)) {
        stop = items[Math.min(stopIndex, items.length - 1)];
      }
      stopIndex = items.indexOf(stop);
      for (const el of items) setTabIndex(el, el === stop ? "0" : "-1");
      return items;
    };

    const repairFocus = (items: HTMLElement[]) => {
      const last = lastFocus;
      if (!last || last.el.isConnected || items.length === 0) return;
      lastFocus = null;
      const active = document.activeElement;
      const focusLost =
        !active ||
        active === document.body ||
        !active.isConnected ||
        active === last.el;
      if (focusLost) items[Math.min(last.index, items.length - 1)]?.focus();
    };

    const onMutation = () => repairFocus(normalize());

    const itemOf = (target: EventTarget | null): HTMLElement | null => {
      if (!(target instanceof HTMLElement)) return null;
      if (target.closest(ROVING_GROUP_SELECTOR)) return null;
      return target.closest<HTMLElement>("[data-toolbar-item]");
    };

    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      if (toolbar.contains(target)) {
        target.setAttribute("data-focus-visible", "true");
      }
      const item = itemOf(target);
      if (!item || !toolbar.contains(item)) return;
      const items = collectToolbarItems(toolbar);
      const index = items.indexOf(item);
      if (index < 0) return;
      stop = item;
      stopIndex = index;
      lastFocus = { el: item, index };
      for (const el of items) setTabIndex(el, el === item ? "0" : "-1");
    };

    const onFocusOut = (event: FocusEvent) => {
      (event.target as HTMLElement).removeAttribute?.("data-focus-visible");
      const next = event.relatedTarget;
      if (next instanceof Node && !toolbar.contains(next)) lastFocus = null;
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const item = itemOf(event.target);
      if (!item) return;
      if (event.key === "Escape") {
        if (!onEscapeRef.current) return;
        event.preventDefault();
        onEscapeRef.current();
        return;
      }
      const move = MOVES[event.key];
      if (!move || event.altKey || event.ctrlKey || event.metaKey) return;
      const items = collectToolbarItems(toolbar);
      if (items.length === 0) return;
      const current = items.indexOf(item);
      const next = move(current < 0 ? 0 : current, items.length - 1);
      event.preventDefault();
      items[(next + items.length) % items.length].focus();
    };

    normalize();
    const observer = new MutationObserver(onMutation);
    observer.observe(toolbar, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["tabindex", "hidden", "disabled"],
    });
    toolbar.addEventListener("focusin", onFocusIn);
    toolbar.addEventListener("focusout", onFocusOut);
    toolbar.addEventListener("keydown", onKeyDown);
    return () => {
      observer.disconnect();
      toolbar.removeEventListener("focusin", onFocusIn);
      toolbar.removeEventListener("focusout", onFocusOut);
      toolbar.removeEventListener("keydown", onKeyDown);
    };
  }, [toolbarRef, onEscapeRef]);
}

const Toolbar = forwardRef<HTMLDivElement, ToolbarProps>(
  ({ children, className, variant = "fixed", onEscape, ...props }, ref) => {
    const toolbarRef = useRef<HTMLDivElement>(null);
    const composedRef = useComposedRef(toolbarRef, ref);
    const onEscapeRef = useRef(onEscape);
    onEscapeRef.current = onEscape;
    useRovingTabindex(toolbarRef, onEscapeRef);

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
          // overflow-visible: a clipped container would cut the 2px focus
          // outline of the first and last items.
          variant === "floating" &&
            "p-0.5 rounded-lg border border-border bg-background shadow-md outline-none overflow-visible",
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
