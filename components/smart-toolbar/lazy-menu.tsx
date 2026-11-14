"use client";

import { type ComponentType, useCallback, useEffect, useRef } from "react";

import { announceLater } from "@/lib/announce-later";
import { CheckIcon as Check } from "@/lib/icons";

import type * as MenuBodiesModule from "./menu-bodies";

type MenuBodies = typeof MenuBodiesModule;

/**
 * The check mark that the menus' checked items, the palette's current row
 * and the colour panel draw, kept in the editor chunk. Only lazy chunks
 * draw it, and Turbopack copies a module that only lazy chunks share into
 * each of them: the palette's copy would count against its first Alt+/
 * budget (contract A7). A local binding, so no re-export skips this module.
 */
export const CheckIcon = Check;

/**
 * Every toolbar menu's popup and items (owner decision O1): one chunk,
 * shared by all menus, so the editor chunk keeps only their triggers and
 * Base UI's menu root. Fetched on a trigger's hover or focus, when the
 * browser is idle after the first server sync (`preloadSurfaces`), and at
 * the latest on the first open, which waits for it (`useMenuGate`).
 */
const loadMenuBodies = () => import("./menu-bodies");

let loaded: MenuBodies | null = null;
let loading: Promise<MenuBodies> | null = null;

/** One fetch at a time; a failed one is tried again by the next call. */
export function preloadMenuBodies(): Promise<MenuBodies> {
  if (loaded) return Promise.resolve(loaded);
  loading ??= loadMenuBodies().then(
    (bodies) => {
      loaded = bodies;
      return bodies;
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

/** For hover and focus: a failure is reported by the open, not here. */
export const prefetchMenuBodies = () => {
  preloadMenuBodies().catch(() => undefined);
};

/**
 * A body from the menu chunk, rendered directly once the chunk is in, and
 * nothing before. No `lazy()`: a menu never opens before its body is
 * loaded (`useMenuGate`), and a `lazy()` would suspend its first render
 * even then, so a keyboard open could miss its first item (Base UI waits
 * only a frame for the list).
 */
export function menuBody<P extends object>(
  pick: (bodies: MenuBodies) => ComponentType<P>,
) {
  // biome-ignore lint/correctness/noComponentHookFactories: called once per body at module level, like `lazy()` itself
  return function MenuBody(props: P) {
    const Body = loaded ? pick(loaded) : null;
    return Body ? <Body {...props} /> : null;
  };
}

/** Why a menu did not open (design pass §12): never stay silent. */
const LOAD_FAILED =
  "Couldn’t open the menu. Check your connection and try again.";

/** Two frames: Base UI moves focus to a newly highlighted item in one. */
const afterFocusMoves = () =>
  new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve)),
  );

const keyInit = (event: KeyboardEvent): KeyboardEventInit => ({
  key: event.key,
  code: event.code,
  shiftKey: event.shiftKey,
  altKey: event.altKey,
  ctrlKey: event.ctrlKey,
  metaKey: event.metaKey,
  repeat: event.repeat,
  bubbles: true,
  cancelable: true,
});

/**
 * Keys pressed while the chunk loaded, sent to whatever has focus once the
 * menu has put it on its first item, one at a time, as if typed there.
 */
async function replay(keys: KeyboardEventInit[]) {
  for (const init of keys) {
    await afterFocusMoves();
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", init));
  }
}

/** What Base UI's `onOpenChange` passes along (its change details). */
interface OpenDetails {
  trigger?: Element;
  event?: Event;
}

/** The menu's trigger: Base UI names it, else the event came from it. */
function triggerOf(details?: OpenDetails): Element | null {
  if (details?.trigger) return details.trigger;
  const target = details?.event?.target;
  return target instanceof Element
    ? target.closest('[aria-haspopup="menu"]')
    : null;
}

const within = (trigger: Element | null, target: EventTarget | null) =>
  trigger !== null && target instanceof Node && trigger.contains(target);

/**
 * Opens a menu only once the menu chunk is in, so the open renders its
 * popup at once and Base UI puts focus on the first item exactly as it
 * does for a loaded menu (the trigger's key decides which). While it
 * loads, the wait behaves like the open menu it stands for:
 * - keys on the trigger are held (they would otherwise move along the
 *   toolbar) and replayed into the menu once it opens;
 * - Esc, a key anywhere else, a press outside the trigger or focus moving
 *   off it cancels the open, as each would close the menu (Esc is used up,
 *   so it does not also leave the toolbar).
 * The listeners are on `window`, in the capture phase: React's own are on
 * the document (the app hydrates it), so they would see the key first.
 * If the chunk does not load, the status pill says so, with Retry, as the
 * palette does. Returns Base UI's `onOpenChange`.
 */
export function useMenuGate(onOpenChange: (open: boolean) => void) {
  const cancel = useRef<(() => void) | null>(null);
  useEffect(() => () => cancel.current?.(), []);
  return useCallback(
    function request(next: boolean, details?: OpenDetails) {
      if (!next || loaded) {
        cancel.current?.();
        onOpenChange(next);
        return;
      }
      if (cancel.current) return;
      const trigger = triggerOf(details);
      const held: KeyboardEventInit[] = [];
      const onKey = (event: KeyboardEvent) => {
        const onTrigger = within(trigger, event.target);
        if (onTrigger || event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
        }
        if (onTrigger && event.key !== "Escape") held.push(keyInit(event));
        else stop();
      };
      const onPointer = (event: PointerEvent) => {
        if (!within(trigger, event.target)) stop();
      };
      const onFocus = (event: FocusEvent) => {
        if (trigger && !within(trigger, event.target)) stop();
      };
      const stop = () => {
        cancel.current = null;
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("pointerdown", onPointer, true);
        window.removeEventListener("focusin", onFocus, true);
      };
      window.addEventListener("keydown", onKey, true);
      window.addEventListener("pointerdown", onPointer, true);
      window.addEventListener("focusin", onFocus, true);
      cancel.current = stop;
      preloadMenuBodies().then(
        () => {
          if (cancel.current !== stop) return;
          stop();
          onOpenChange(true);
          if (held.length > 0) void replay(held);
        },
        () => {
          if (cancel.current !== stop) return;
          stop();
          announceLater(LOAD_FAILED, {
            action: { label: "Retry", run: () => request(true) },
          });
        },
      );
    },
    [onOpenChange],
  );
}
