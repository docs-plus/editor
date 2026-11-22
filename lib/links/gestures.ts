/**
 * Which tab a document link opens in, and which link it was (search-linking
 * §4.3). The Hyperlink extension calls `navigate(href, { newTab })` with
 * `newTab: true` for Mod or the middle button, and passes no event. We want
 * Mod alone → this tab, Mod+Shift or the middle button → a new tab, and the
 * followed link's position for Back, so the host records the last
 * activating gesture here (capture phase on the window, which runs before
 * the editor's own listeners) and `navigate` reads it.
 */
export interface LinkGestures {
  /** True when the last gesture held Shift or used the middle button. */
  wantsNewTab(): boolean;
  /**
   * The link the last gesture landed on (a click, or Enter on a focused
   * link); null when it landed elsewhere, as Alt+Enter in the editor does.
   */
  lastAnchor(): HTMLAnchorElement | null;
  dispose(): void;
}

const MIDDLE_BUTTON = 1;
const EVENTS = ["pointerdown", "mousedown", "auxclick", "keydown"] as const;

export function trackLinkGestures(target: Window | Document): LinkGestures {
  let newTab = false;
  let anchor: HTMLAnchorElement | null = null;
  const record = (event: Event) => {
    // Every gesture overwrites the last, so an old Shift or link never
    // carries over.
    if (event instanceof KeyboardEvent) {
      newTab = event.shiftKey;
    } else if (event instanceof MouseEvent) {
      newTab = event.shiftKey || event.button === MIDDLE_BUTTON;
    }
    anchor =
      event.target instanceof Element
        ? event.target.closest<HTMLAnchorElement>("a[href]")
        : null;
  };
  for (const type of EVENTS) target.addEventListener(type, record, true);
  return {
    wantsNewTab: () => newTab,
    lastAnchor: () => anchor,
    dispose() {
      for (const type of EVENTS) target.removeEventListener(type, record, true);
      anchor = null;
    },
  };
}
