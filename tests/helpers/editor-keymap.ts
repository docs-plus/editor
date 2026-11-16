import {
  type AnyConfig,
  Editor,
  type Extensions,
  getExtensionField,
  getSchemaTypeByName,
} from "@tiptap/core";

const MODIFIER_ORDER = ["Mod", "Ctrl", "Alt", "Shift", "Meta"] as const;

/**
 * One spelling per combo, so `Shift-Mod-z` and `Mod-Shift-z` compare equal:
 * modifiers in the order Mod, Ctrl, Alt, Shift, Meta, and a one-character
 * key lowercased.
 */
export function normalizeCombo(combo: string): string {
  // A trailing "-" is the key itself (`Mod--`), not a separator.
  const parts = combo.endsWith("--")
    ? [...combo.slice(0, -2).split("-"), "-"]
    : combo.split("-");
  const key = parts.pop() ?? "";
  const mods = MODIFIER_ORDER.filter((mod) => parts.includes(mod));
  const normalizedKey = key.length === 1 ? key.toLowerCase() : key;
  return [...mods, normalizedKey].join("-");
}

/**
 * Every key each extension binds: normalized combo → names of the extensions
 * that bind it. Calls `addKeyboardShortcuts` with the context Tiptap's
 * `ExtensionManager` builds, on a real editor, so options and storage are
 * the ones the app runs with. Tiptap's core extensions are counted too.
 * An extension that binds one combo under two spellings counts once.
 */
export function collectEditorKeys(
  extensions: Extensions,
): Map<string, string[]> {
  const editor = new Editor({
    element: document.createElement("div"),
    extensions,
  });
  try {
    const keys = new Map<string, string[]>();
    for (const ext of editor.extensionManager.extensions) {
      const addKeyboardShortcuts = getExtensionField<
        AnyConfig["addKeyboardShortcuts"]
      >(ext, "addKeyboardShortcuts", {
        name: ext.name,
        options: ext.options,
        storage: editor.extensionStorage[ext.name as never],
        editor,
        type: getSchemaTypeByName(ext.name, editor.schema),
      });
      if (!addKeyboardShortcuts) continue;
      // Marks bind both cases (`Mod-b`, `Mod-B`): one binding, not two.
      const combos = new Set(
        Object.keys(addKeyboardShortcuts()).map(normalizeCombo),
      );
      for (const combo of combos) {
        keys.set(combo, [...(keys.get(combo) ?? []), ext.name]);
      }
    }
    return keys;
  } finally {
    editor.destroy();
  }
}
