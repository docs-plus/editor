"use client";

import { forwardRef, useCallback, useEffect, useRef, useState } from "react";

import { useComposedRef } from "@/hooks/use-composed-ref";
import { useMenuNavigation } from "@/hooks/use-menu-navigation";
import { cn } from "@/lib/utils";

type BaseProps = React.HTMLAttributes<HTMLDivElement>;

interface ToolbarProps extends BaseProps {
  variant?: "floating" | "fixed";
}

function useToolbarNavigation(
  toolbarRef: React.RefObject<HTMLDivElement | null>,
) {
  const [items, setItems] = useState<HTMLElement[]>([]);

  const collectItems = useCallback(() => {
    if (!toolbarRef.current) return [];
    return Array.from(
      toolbarRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [role="button"]:not([disabled]), [tabindex="0"]:not([disabled])',
      ),
    );
  }, [toolbarRef]);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;

    const updateItems = () => setItems(collectItems());

    updateItems();
    const observer = new MutationObserver(updateItems);
    observer.observe(toolbar, { childList: true, subtree: true });

    return () => observer.disconnect();
  }, [collectItems, toolbarRef]);

  const { selectedIndex } = useMenuNavigation<HTMLElement>({
    containerRef: toolbarRef,
    items,
    orientation: "horizontal",
    onSelect: (el) => el.click(),
    autoSelectFirstItem: false,
  });

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

    toolbar.addEventListener("focus", handleFocus, true);
    toolbar.addEventListener("blur", handleBlur, true);

    return () => {
      toolbar.removeEventListener("focus", handleFocus, true);
      toolbar.removeEventListener("blur", handleBlur, true);
    };
  }, [toolbarRef]);

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
        aria-label="toolbar"
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
