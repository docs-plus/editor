/**
 * Alt+/ (fallback Alt+Shift+Z) matching for the action palette (spec §4.4).
 * Eager and tiny: the palette host imports it; the palette itself is lazy.
 */

export type PaletteKeyEvent = Pick<
  KeyboardEvent,
  | "code"
  | "key"
  | "altKey"
  | "ctrlKey"
  | "metaKey"
  | "shiftKey"
  | "isComposing"
  | "repeat"
>;

/**
 * Alt with a key that produces "/" (wherever the layout puts it), or the
 * physical slash key when it produces "÷" (macOS US-like layouts, where
 * the spec gives up ⌥/). The physical key alone is not enough: on German
 * and Swiss Mac layouts it is ⌥- (en dash "–"), which must keep typing.
 * Ctrl+Alt is AltGr on Windows: never ours.
 */
export function matchPaletteHotkey(event: PaletteKeyEvent): boolean {
  if (!event.altKey || event.ctrlKey || event.metaKey) return false;
  if (event.isComposing || event.repeat) return false;
  if (event.key === "/") return true;
  if (event.code === "Slash") return event.key === "÷" && !event.shiftKey;
  if (event.code === "KeyZ") return event.shiftKey;
  return false;
}

const TEXT_INPUT = "input, textarea, select, [contenteditable]";

/**
 * Whether the key belongs to the palette at this focus target: the editor,
 * the toolbar, the page and the palette itself. Any other text field or
 * dialog keeps its keystroke (a link URL input still types "÷").
 */
export function shouldHandlePaletteKey(target: EventTarget | null): boolean {
  if (!target || typeof Element === "undefined") return true;
  if (!(target instanceof Element)) return true;
  if (target.closest("[data-command-palette]")) return true;
  if (target.closest(".tiptap, .ProseMirror")) return true;
  if (target.closest('[role="dialog"], [role="alertdialog"]')) return false;
  if (target.closest(TEXT_INPUT)) return false;
  return true;
}
