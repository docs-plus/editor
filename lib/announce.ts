/**
 * Polite screen-reader announcements (WCAG 4.1.3) through one persistent,
 * visually hidden `role="status"` node, added to `body` on first use. Each
 * call clears the node, then sets the text a moment later, so a repeated
 * message is read again and a node created in this call is read at all.
 * Import it from lazy surfaces only. A no-op on the server.
 */
let region: HTMLElement | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;

export function announce(message: string): void {
  if (typeof document === "undefined") return;
  if (!region?.isConnected) {
    region = document.createElement("div");
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    region.className = "sr-only";
    document.body.append(region);
  }
  const node = region;
  node.textContent = "";
  clearTimeout(timer);
  timer = setTimeout(() => {
    node.textContent = message;
  }, 100);
}
