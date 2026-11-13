/**
 * One polite, persistent live region for short results ("Repeated Bold",
 * "Nothing to copy"). Created on first use and kept in `body`: a region
 * inserted together with its text is often not read. The text is set on
 * the next frame after clearing, so the same message twice is read twice.
 */
let region: HTMLElement | null = null;

export function announce(message: string): void {
  if (typeof document === "undefined") return;
  if (!region?.isConnected) {
    region = document.createElement("div");
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.className = "sr-only";
    region.dataset.announcer = "";
    document.body.append(region);
  }
  const node = region;
  node.textContent = "";
  requestAnimationFrame(() => {
    node.textContent = message;
  });
}
