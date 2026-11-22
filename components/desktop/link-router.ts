/**
 * Desktop link routing (N2). Main denies every `window.open` and never
 * sends one to the browser, so an embed or ad frame can't open a tab. The
 * app's own links reach the system browser only through the bridge call
 * `shell.openLink`, which main accepts from the app's top frame alone (the
 * IPC sender check) and passes through its https-only rate gate.
 *
 * This runs in the top frame only (DesktopRoot):
 * - `window.open(url)` (the hyperlink popover's Open, the X link card)
 *   goes to the bridge and returns `null`, as a refused popup would;
 * - a click on an `<a target="_blank">`, or a modifier or middle click on
 *   any link, outside the editor goes to the bridge too (the Privacy link,
 *   the identity menu's links). Clicks inside the editor are left to the
 *   hyperlink extension, which shows its popover.
 */
import type { TinydocyBridge } from "@/desktop/shared/ipc-contract";

function urlOf(raw: unknown): string {
  if (raw instanceof URL) return raw.href;
  return typeof raw === "string" ? raw : "";
}

/**
 * The link a click should send to the browser, or null: an anchor outside
 * the editor that opens in a new window (`target="_blank"`, a middle click
 * or a modifier click). A right or back/forward button's `auxclick` never
 * counts, even on a `_blank` link. Trust is checked by the caller.
 */
export function leavingLinkOf(event: MouseEvent): string | null {
  // auxclick also fires for the right button: only a middle click opens.
  if (event.type === "auxclick" && event.button !== 1) return null;
  const target = event.target as Element | null;
  const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor || anchor.closest(".ProseMirror")) return null;
  const leavesApp =
    anchor.target === "_blank" ||
    event.button === 1 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey;
  return leavesApp ? anchor.href : null;
}

export function installLinkRouter(bridge: TinydocyBridge): () => void {
  const openLink = (raw: unknown) => {
    const url = urlOf(raw);
    if (url) void bridge.invoke("shell.openLink", { url }).catch(() => {});
  };

  const original = window.open;
  window.open = ((url?: string | URL) => {
    openLink(url);
    return null;
  }) as typeof window.open;

  const onClick = (event: MouseEvent) => {
    if (!event.isTrusted || event.defaultPrevented) return;
    const href = leavingLinkOf(event);
    if (!href) return;
    event.preventDefault();
    openLink(href);
  };
  document.addEventListener("click", onClick, true);
  document.addEventListener("auxclick", onClick, true);

  return () => {
    window.open = original;
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("auxclick", onClick, true);
  };
}
