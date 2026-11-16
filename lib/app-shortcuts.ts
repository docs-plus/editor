import type { KeyCombo } from "@/lib/editor-actions/types";

/** Opens Settings. Desktop only; nothing binds it on the web. */
export const SETTINGS_SHORTCUT: KeyCombo = "Mod-,";

/**
 * Toggles subscript. Desktop builds move it to ⌘⇧, so that ⌘, can open
 * Settings; the web keeps ⌘,. `next.config.ts` always defines the target,
 * so this literal comparison is inlined and folded at build time.
 */
export const SUBSCRIPT_SHORTCUT: KeyCombo =
  process.env.NEXT_PUBLIC_APP_TARGET === "desktop" ? "Mod-Shift-," : "Mod-,";

export type TabBarCommand = "newTab" | "closeTab" | "previousTab" | "nextTab";

/**
 * The tab bar's keys, handled on `window`, outside the editor keymap. None
 * may also be an editor key (`shortcut-bindings.test.ts`). Regenerate has
 * no key: ⌘⇧R is Align right in the editor and hard reload elsewhere.
 */
export const TAB_BAR_SHORTCUTS: Readonly<Record<TabBarCommand, KeyCombo>> = {
  newTab: "Mod-t",
  closeTab: "Mod-w",
  previousTab: "Mod-Shift-[",
  nextTab: "Mod-Shift-]",
};

/** Shift turns `[` and `]` into `{` and `}` on most layouts. */
const SHIFTED_KEYS: Readonly<Record<string, string>> = { "{": "[", "}": "]" };

const TAB_BAR_KEYS = Object.entries(TAB_BAR_SHORTCUTS).map(
  ([command, combo]) => {
    const parts = combo.split("-");
    return {
      command: command as TabBarCommand,
      key: parts[parts.length - 1],
      shift: parts.includes("Shift"),
    };
  },
);

/**
 * The tab-bar command a keydown asks for, or `null`. The key compares
 * case-insensitively (Caps Lock and Shift change `event.key`'s case), and
 * Shift must match the combo exactly, so ⌘⇧T (reopen closed tab) stays
 * the browser's.
 */
export function matchTabBarShortcut(
  event: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "shiftKey">,
): TabBarCommand | null {
  if (!event.metaKey && !event.ctrlKey) return null;
  const key = SHIFTED_KEYS[event.key] ?? event.key.toLowerCase();
  const match = TAB_BAR_KEYS.find(
    (entry) => entry.key === key && entry.shift === event.shiftKey,
  );
  return match?.command ?? null;
}
