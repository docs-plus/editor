import type { KeyCombo } from "@/lib/editor-actions/types";

/**
 * Visible shortcut text: `"Mod-b"` → "⌘B" on macOS, "Ctrl+B" elsewhere.
 * SKELETON: PR D1 implements (reusing `lib/shortcuts.ts`).
 */
export function formatKeyCombo(combo: KeyCombo, _mac: boolean): string {
  return combo;
}

/**
 * `aria-keyshortcuts` value: `"Mod-b"` → "Meta+B" on macOS, "Control+B"
 * elsewhere (#612). SKELETON: PR D1 implements.
 */
export function ariaKeyShortcuts(combo: KeyCombo, _mac: boolean): string {
  return combo;
}
