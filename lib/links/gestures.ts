/**
 * Which tab a document link opens in (search-linking §4.3). The Hyperlink
 * extension calls `navigate(href, { newTab })` with `newTab: true` for Mod
 * or the middle button, and passes no event. We want Mod alone → this tab,
 * Mod+Shift or the middle button → a new tab, so the host records the
 * last activating gesture here (capture phase on the window, which runs
 * before the editor's own listeners) and `navigate` reads it.
 */
export interface LinkGestures {
  /** True when the last gesture held Shift or used the middle button. */
  wantsNewTab(): boolean;
  dispose(): void;
}

const MIDDLE_BUTTON = 1;
const EVENTS = ["pointerdown", "mousedown", "auxclick", "keydown"] as const;

export function trackLinkGestures(target: Window | Document): LinkGestures {
  let newTab = false;
  const record = (event: Event) => {
    // Every gesture overwrites the last, so an old Shift never carries over.
    if (event instanceof KeyboardEvent) {
      newTab = event.shiftKey;
    } else if (event instanceof MouseEvent) {
      newTab = event.shiftKey || event.button === MIDDLE_BUTTON;
    }
  };
  for (const type of EVENTS) target.addEventListener(type, record, true);
  return {
    wantsNewTab: () => newTab,
    dispose() {
      for (const type of EVENTS) target.removeEventListener(type, record, true);
    },
  };
}
