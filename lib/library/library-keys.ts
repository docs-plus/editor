/**
 * Keys of the files sidebar and Quick Open (UX §4.6), as pure predicates so
 * both platforms' branches are unit-tested on any host. `mac` comes from
 * `isMac()` (`lib/shortcuts.ts`). Letter shortcuts also match the physical
 * key (`code`), so they work on Persian and Arabic layouts.
 */
type Key = Pick<
  KeyboardEvent,
  "key" | "code" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;
type Modifiers = Pick<
  KeyboardEvent,
  "metaKey" | "ctrlKey" | "shiftKey" | "altKey"
>;

/** ⌘ on macOS, Ctrl elsewhere, and not the other one. */
function primary(event: Modifiers, mac: boolean): boolean {
  return mac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
}

function letter(event: Key, char: string): boolean {
  return (
    event.key.toLowerCase() === char ||
    event.code === `Key${char.toUpperCase()}`
  );
}

/** Move to Trash (scoped to the tree and lists): ⌘⌫ or Delete. */
export function isTrashKey(event: Key, mac: boolean): boolean {
  if (event.shiftKey || event.altKey) return false;
  if (event.key === "Delete") return !event.metaKey && !event.ctrlKey;
  return mac && event.key === "Backspace" && primary(event, mac);
}

/** File-operation undo (UX §6.2): ⌘Z / Ctrl+Z, not ⌘⇧Z. */
export function isUndoKey(event: Key, mac: boolean): boolean {
  return (
    primary(event, mac) &&
    !event.shiftKey &&
    !event.altKey &&
    letter(event, "z")
  );
}

/** Quick Open: ⌘O / Ctrl+O. */
export function isQuickOpenKey(event: Key, mac: boolean): boolean {
  return (
    primary(event, mac) &&
    !event.shiftKey &&
    !event.altKey &&
    letter(event, "o")
  );
}

/** New Folder (scoped): ⌘⇧N / Ctrl+Shift+N. The web never receives it. */
export function isNewFolderKey(event: Key, mac: boolean): boolean {
  return (
    primary(event, mac) && event.shiftKey && !event.altKey && letter(event, "n")
  );
}

/**
 * Filter list (P2.7b): ⌘F / Ctrl+F, bound on the list itself so Find
 * (P2.11) stays the editor's.
 */
export function isFilterKey(event: Key, mac: boolean): boolean {
  return (
    primary(event, mac) &&
    !event.shiftKey &&
    !event.altKey &&
    letter(event, "f")
  );
}

/** Select all in the list or folder: ⌘A / Ctrl+A. */
export function isSelectAllKey(event: Key, mac: boolean): boolean {
  return (
    primary(event, mac) &&
    !event.shiftKey &&
    !event.altKey &&
    letter(event, "a")
  );
}

/**
 * Move Up / Move Down in a Manual-sorted list (details §6.1): ⌥⌘↑ / ⌥⌘↓,
 * Ctrl+Alt+↑ / ↓ off macOS.
 */
export function manualMoveKey(event: Key, mac: boolean): "up" | "down" | null {
  if (!primary(event, mac) || !event.altKey || event.shiftKey) return null;
  if (event.key === "ArrowUp") return "up";
  if (event.key === "ArrowDown") return "down";
  return null;
}

/** Shift+F10 or the Menu key. */
export function isContextMenuKey(event: Key): boolean {
  return (
    event.key === "ContextMenu" ||
    (event.key === "F10" && event.shiftKey && !event.ctrlKey && !event.metaKey)
  );
}

export type OpenTarget = "current" | "tab" | "window";

/**
 * Where a click or Enter opens (UX §4.1): ⌘ / Ctrl → a new tab; ⌥⌘, or
 * Shift off macOS → a new window.
 */
export function openTarget(event: Modifiers, mac: boolean): OpenTarget {
  if (mac) {
    if (event.metaKey && event.altKey) return "window";
    return event.metaKey ? "tab" : "current";
  }
  if (event.shiftKey) return "window";
  return event.ctrlKey ? "tab" : "current";
}

/**
 * → and ← in the tree follow what the person sees: in a right-to-left
 * sidebar, ← goes into a folder and → back out.
 */
export function horizontalIntent(
  key: string,
  dir: "ltr" | "rtl",
): "in" | "out" | null {
  if (key !== "ArrowRight" && key !== "ArrowLeft") return null;
  const forward = key === (dir === "rtl" ? "ArrowLeft" : "ArrowRight");
  return forward ? "in" : "out";
}
