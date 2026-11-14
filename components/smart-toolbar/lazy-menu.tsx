"use client";

import {
  type ComponentType,
  type KeyboardEvent,
  useCallback,
  useRef,
} from "react";

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

const keyInit = (event: globalThis.KeyboardEvent): KeyboardEventInit => ({
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

/**
 * Opens a menu only once the menu chunk is in, so the open renders its
 * popup at once and Base UI puts focus on the first item exactly as it
 * does for a loaded menu (the trigger's key decides which). Keys pressed
 * while it loads are held on the trigger (they would otherwise move along
 * the toolbar) and replayed into the menu. If the chunk does not load, the
 * status pill says so, with Retry, as the palette does.
 */
export function useMenuGate(onOpenChange: (open: boolean) => void) {
  // Non-null while an open waits for the chunk: the keys typed meanwhile.
  const held = useRef<KeyboardEventInit[] | null>(null);
  const requestOpen = useCallback(
    function request(next: boolean) {
      if (!next || loaded) {
        held.current = null;
        onOpenChange(next);
        return;
      }
      if (held.current) return;
      held.current = [];
      preloadMenuBodies().then(
        () => {
          const keys = held.current ?? [];
          held.current = null;
          onOpenChange(true);
          if (keys.length > 0) void replay(keys);
        },
        () => {
          held.current = null;
          announceLater(LOAD_FAILED, {
            action: { label: "Retry", run: () => request(true) },
          });
        },
      );
    },
    [onOpenChange],
  );
  const onKeyDownCapture = useCallback((event: KeyboardEvent) => {
    const keys = held.current;
    if (!keys) return;
    event.preventDefault();
    event.stopPropagation();
    keys.push(keyInit(event.nativeEvent));
  }, []);
  return { onOpenChange: requestOpen, onKeyDownCapture };
}
