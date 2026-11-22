/**
 * F6 / Shift+F6 between regions (UX §8.2): tabs, sidebar, toolbar,
 * document, outline. A region is any element with `data-region` and an
 * `aria-label`; hidden ones are skipped. Landing on a region focuses, in
 * order: the element last focused there (`trackRegionFocus`), its
 * `[data-region-entry]`, its roving tab stop, or its first focusable
 * element. The region gets `data-region-flash` for 1 s (its focus flash).
 * Plain DOM, no React: the desktop shell and the web library both wire it.
 */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), [contenteditable="true"], [tabindex="0"], a[href]';
const FLASH_MS = 1000;

const lastFocused = new WeakMap<Element, HTMLElement>();
const flashTimers = new WeakMap<Element, ReturnType<typeof setTimeout>>();

function visible(element: Element): boolean {
  return !element.closest("[hidden], [inert]");
}

function entryPoint(region: Element): HTMLElement | null {
  const remembered = lastFocused.get(region);
  if (remembered?.isConnected && region.contains(remembered)) return remembered;
  return (
    region.querySelector<HTMLElement>("[data-region-entry]") ??
    region.querySelector<HTMLElement>(FOCUSABLE)
  );
}

/** Remembers the last focused element of each region under `root`. */
export function trackRegionFocus(root: ParentNode & Node): () => void {
  const onFocusIn = (event: Event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const region = target.closest("[data-region]");
    if (region) lastFocused.set(region, target);
  };
  root.addEventListener("focusin", onFocusIn);
  return () => root.removeEventListener("focusin", onFocusIn);
}

/**
 * Focuses the next (or, with `back`, previous) region and returns its
 * label for `announce`; null when there is nowhere to go.
 */
export function cycleRegion(root: ParentNode, back: boolean): string | null {
  const regions = [...root.querySelectorAll("[data-region]")].filter(visible);
  if (regions.length === 0) return null;
  const active = document.activeElement;
  const current = regions.findIndex((region) => region.contains(active));
  const step = back ? -1 : 1;
  const start = current < 0 ? (back ? 0 : -1) : current;
  for (let tries = 1; tries <= regions.length; tries++) {
    const region =
      regions[(start + step * tries + regions.length * 2) % regions.length];
    const target = entryPoint(region);
    if (!target) continue;
    target.focus();
    region.setAttribute("data-region-flash", "");
    clearTimeout(flashTimers.get(region));
    flashTimers.set(
      region,
      setTimeout(() => region.removeAttribute("data-region-flash"), FLASH_MS),
    );
    return region.getAttribute("aria-label");
  }
  return null;
}
