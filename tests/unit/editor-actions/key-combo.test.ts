import { describe, expect, it } from "bun:test";

import {
  ariaKeyShortcuts,
  formatKeyCombo,
  toShortcutKeys,
} from "@/lib/editor-actions/key-combo";

describe("formatKeyCombo", () => {
  it.each([
    ["Mod-b", "⌘B", "Ctrl+B"],
    ["Mod-Shift-z", "⌘⇧Z", "Ctrl+Shift+Z"],
    ["Mod-\\", "⌘\\", "Ctrl+\\"],
    ["Mod-Alt-v", "⌘⌥V", "Ctrl+Alt+V"],
    ["Alt-F10", "⌥F10", "Alt+F10"],
    ["F4", "F4", "F4"],
    ["Mod--", "⌘-", "Ctrl+-"],
  ])("%s → %s / %s", (combo, mac, other) => {
    expect(formatKeyCombo(combo, true)).toBe(mac);
    expect(formatKeyCombo(combo, false)).toBe(other);
  });
});

describe("ariaKeyShortcuts", () => {
  it.each([
    ["Mod-b", "Meta+B", "Control+B"],
    ["Mod-Shift-z", "Meta+Shift+Z", "Control+Shift+Z"],
    ["Mod-\\", "Meta+\\", "Control+\\"],
    ["Alt-F10", "Alt+F10", "Alt+F10"],
    ["Mod-.", "Meta+.", "Control+."],
  ])("%s → %s / %s", (combo, mac, other) => {
    expect(ariaKeyShortcuts(combo, true)).toBe(mac);
    expect(ariaKeyShortcuts(combo, false)).toBe(other);
  });
});

describe("toShortcutKeys", () => {
  it("converts to the ShortcutDisplay notation", () => {
    expect(toShortcutKeys("Mod-Shift-z")).toBe("mod+shift+z");
    expect(toShortcutKeys("Mod-\\")).toBe("mod+\\");
  });
});
