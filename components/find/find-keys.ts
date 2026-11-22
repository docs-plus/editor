import { supportsHighlights } from "@/extensions/find/highlight-support";

/**
 * Find in the document (P2.11, details spec E1). `NEXT_PUBLIC_FIND=0`
 * turns it off: ⌘F / Ctrl+F then opens the browser's own find bar again.
 * The literal comparison is inlined at build time.
 */
export const FIND_ENABLED = process.env.NEXT_PUBLIC_FIND !== "0";

/**
 * Find takes ⌘F only where it can paint its hits (the CSS Custom
 * Highlight API). Elsewhere (Firefox before 140, Safari before 17.2) the
 * browser keeps its own find bar rather than a bar that steps through
 * hits it cannot show.
 */
export function findAvailable(): boolean {
  return FIND_ENABLED && supportsHighlights();
}

/** A field, list or dialog that owns its own keys. */
const FOREIGN_KEY_TARGET =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [aria-modal="true"]';

/**
 * Whether a Find key pressed on `target` is Find's: in the editor, the
 * find bar or the page, but not in another text field (a tab rename, a
 * dialog's search) or inside a dialog, which keep their own keys.
 */
export function isFindKeyTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest("[data-find-bar], .ProseMirror")) return true;
  return target.closest(FOREIGN_KEY_TARGET) === null;
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
