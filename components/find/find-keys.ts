import { supportsHighlights } from "@/extensions/find/highlight-support";

/**
 * Find in the document (P2.11, details spec E1). On in the desktop app;
 * off on the web until the owner decides to take ⌘F from the browser there
 * (#158). `NEXT_PUBLIC_FIND=1` turns it on for any build and `0` turns it
 * off for any build, when ⌘F / Ctrl+F opens the browser's own find bar.
 * Both are inlined at build time (`next.config.ts` always defines them);
 * `editor-app.tsx` repeats the check inline so a build with Find off
 * leaves the key listener out, which an imported constant does not.
 */
export const FIND_ENABLED =
  process.env.NEXT_PUBLIC_FIND === "1" ||
  (process.env.NEXT_PUBLIC_FIND !== "0" &&
    process.env.NEXT_PUBLIC_APP_TARGET === "desktop");

/**
 * Find takes ⌘F only where it can paint its hits (the CSS Custom
 * Highlight API). Elsewhere (Firefox before 140, Safari before 17.2) the
 * browser keeps its own find bar rather than a bar that steps through
 * hits it cannot show.
 */
export function findAvailable(): boolean {
  return FIND_ENABLED && supportsHighlights();
}

/** A field or dialog that owns its keys, even inside the editor (a node view's field). */
const FIELD_OR_DIALOG =
  'input, textarea, select, [role="dialog"], [aria-modal="true"]';

/**
 * Whether a Find key pressed on `target` is Find's: in the editor's text,
 * the find bar or the page, but not in another text field (a tab rename, a
 * node view's source field, a dialog's search), another editable area or
 * a dialog, which keep their own keys.
 */
export function isFindKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest("[data-find-bar]")) return true;
  if (target.closest(FIELD_OR_DIALOG)) return false;
  if (target.closest(".ProseMirror")) return true;
  return (
    target.closest('[contenteditable]:not([contenteditable="false"])') === null
  );
}

/**
 * macOS, where Find's keys use ⌘. Same test as `isMac()` in
 * `lib/shortcuts.ts`, repeated so the app shell does not import that
 * module: sharing it moves it out of the editor chunk group (measured).
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const data = (navigator as { userAgentData?: { platform: string } })
    .userAgentData;
  return data ? data.platform === "macOS" : /mac/i.test(navigator.userAgent);
}

/** What a Find key asks for. */
export type FindCommand = "open" | "replace" | "next" | "previous";

export interface FindKeyContext {
  mac: boolean;
  /** The desktop app (`NEXT_PUBLIC_APP_TARGET=desktop`), where Replace has a key. */
  desktop: boolean;
}

type FindKeyEvent = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey"
>;

/**
 * The letter a key press means: `event.key` on Latin layouts (so Dvorak's
 * F is F), the physical key (`KeyF`) on others, where `event.key` is a
 * Persian or Cyrillic letter, or a symbol when ⌥ is held on a Mac.
 */
function letterOf(event: FindKeyEvent): string {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  return /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : "";
}

/**
 * The Find command a keydown asks for, or null (UX spec §4.6):
 *
 * | | macOS | Windows and Linux |
 * |---|---|---|
 * | Find | ⌘F | Ctrl+F |
 * | Next / previous | ⌘G / ⌘⇧G | F3 / Shift+F3, Ctrl+G / Ctrl+Shift+G |
 * | Replace | ⌥⌘F (desktop app) | Ctrl+H (desktop app) |
 *
 * On the web Replace has no key (the browser owns Ctrl+H); it is reached
 * from the find bar. ⌘⇧F stays the heading filter's.
 */
export function matchFindShortcut(
  event: FindKeyEvent,
  { mac, desktop }: FindKeyContext,
): FindCommand | null {
  if (event.key === "F3" && !mac) {
    if (event.metaKey || event.ctrlKey || event.altKey) return null;
    return event.shiftKey ? "previous" : "next";
  }
  const mod = mac ? event.metaKey : event.ctrlKey;
  const other = mac ? event.ctrlKey : event.metaKey;
  if (!mod || other) return null;
  const letter = letterOf(event);
  if (letter === "f" && !event.shiftKey) {
    if (!event.altKey) return "open";
    return mac && desktop ? "replace" : null;
  }
  if (event.altKey) return null;
  if (letter === "g") return event.shiftKey ? "previous" : "next";
  if (letter === "h" && !mac && desktop && !event.shiftKey) return "replace";
  return null;
}
