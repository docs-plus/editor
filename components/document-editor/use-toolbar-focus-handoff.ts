"use client";

import { type RefObject, useCallback, useEffect, useRef } from "react";

import { focusRovingItem } from "@/components/ui/toolbar";

/**
 * Crossing 768px swaps the sticky row and the phone bar (spec §4.7). The
 * focused item goes with its toolbar and focus drops to `body`; this hands
 * it to the toolbar that mounts next: the same action (`data-action-id`)
 * when it shows one, else its tab stop. `focusin` records the last item
 * focused in a toolbar (cleared once focus lands anywhere else); removal
 * fires no `focusin`, so the record survives the swap. Nothing moves
 * unless focus is still on `body`.
 *
 * Returns a callback ref for both toolbars; it also fills `toolbarRef`.
 */
export function useToolbarFocusHandoff(
  toolbarRef: RefObject<HTMLDivElement | null>,
) {
  // The focused item's action id ("" without one); null outside toolbars.
  const lastItemRef = useRef<string | null>(null);

  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as HTMLElement;
      lastItemRef.current = toolbarRef.current?.contains(target)
        ? (target.dataset.actionId ?? "")
        : null;
    };
    document.addEventListener("focusin", onFocusIn, true);
    return () => document.removeEventListener("focusin", onFocusIn, true);
  }, [toolbarRef]);

  return useCallback(
    (node: HTMLDivElement | null) => {
      toolbarRef.current = node;
      const id = lastItemRef.current;
      if (!node || id === null) return;
      // After the toolbar's own effects have stamped the roving tabindex.
      requestAnimationFrame(() => {
        if (document.activeElement !== document.body) return;
        const same = id
          ? node.querySelector<HTMLButtonElement>(`[data-action-id="${id}"]`)
          : null;
        if (same?.checkVisibility() && !same.disabled) same.focus();
        else focusRovingItem(node);
      });
    },
    [toolbarRef],
  );
}
