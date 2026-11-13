import type { KeyCombo } from "@/lib/editor-actions/types";
import { MAC_SYMBOLS } from "@/lib/shortcuts";

type Modifier = "Mod" | "Shift" | "Alt" | "Ctrl" | "Meta";

const MODIFIERS = new Set<string>(["Mod", "Shift", "Alt", "Ctrl", "Meta"]);

/** Splits ProseMirror notation into modifiers and the key (`"Mod--"` → `-`). */
function parseCombo(combo: KeyCombo): { mods: Modifier[]; key: string } {
  const parts = combo.split("-");
  let key = parts.pop() ?? "";
  if (key === "" && parts.at(-1) === "") {
    parts.pop();
    key = "-";
  }
  const mods = parts.filter((part): part is Modifier => MODIFIERS.has(part));
  return { mods, key: key.length === 1 ? key.toUpperCase() : key };
}

const MAC_MOD: Record<Modifier, string> = {
  Mod: MAC_SYMBOLS.mod,
  Shift: MAC_SYMBOLS.shift,
  Alt: MAC_SYMBOLS.alt,
  Ctrl: MAC_SYMBOLS.ctrl,
  Meta: MAC_SYMBOLS.meta,
};
const OTHER_MOD: Record<Modifier, string> = {
  Mod: "Ctrl",
  Shift: "Shift",
  Alt: "Alt",
  Ctrl: "Ctrl",
  Meta: "Meta",
};

/** Visible shortcut text: `"Mod-b"` → "⌘B" on macOS, "Ctrl+B" elsewhere. */
export function formatKeyCombo(combo: KeyCombo, mac: boolean): string {
  const { mods, key } = parseCombo(combo);
  if (mac) return mods.map((mod) => MAC_MOD[mod]).join("") + key;
  return [...mods.map((mod) => OTHER_MOD[mod]), key].join("+");
}

const ARIA_MOD: Record<Modifier, (mac: boolean) => string> = {
  Mod: (mac) => (mac ? "Meta" : "Control"),
  Shift: () => "Shift",
  Alt: () => "Alt",
  Ctrl: () => "Control",
  Meta: () => "Meta",
};

/**
 * `aria-keyshortcuts` value: `"Mod-b"` → "Meta+B" on macOS, "Control+B"
 * elsewhere (#612).
 */
export function ariaKeyShortcuts(combo: KeyCombo, mac: boolean): string {
  const { mods, key } = parseCombo(combo);
  return [...mods.map((mod) => ARIA_MOD[mod](mac)), key].join("+");
}

/** `"Mod-Shift-z"` → `"mod+shift+z"`, the notation `ShortcutDisplay` reads. */
export function toShortcutKeys(combo: KeyCombo): string {
  const { mods, key } = parseCombo(combo);
  return [...mods, key].map((part) => part.toLowerCase()).join("+");
}
