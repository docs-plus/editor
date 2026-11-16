import { Menu, type MenuItemConstructorOptions } from "electron";

export type MenuIntent = "undo" | "redo" | "bold";

interface MenuOptions {
  /** false: the menu shows the combo but the key stays with the renderer. */
  registerAccelerator: boolean;
  onIntent: (intent: MenuIntent) => void;
}

/** Edit and Format menus whose items send intents instead of using roles. */
export function installMenu({ registerAccelerator, onIntent }: MenuOptions) {
  const isMac = process.platform === "darwin";
  const item = (
    id: MenuIntent,
    label: string,
    accelerator: string,
  ): MenuItemConstructorOptions => ({
    id,
    label,
    accelerator,
    registerAccelerator,
    click: () => onIntent(id),
  });
  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? [{ role: "appMenu" as const }]
      : [{ role: "fileMenu" as const }]),
    {
      label: "Edit",
      submenu: [
        item("undo", "Undo", "CmdOrCtrl+Z"),
        item("redo", "Redo", isMac ? "Shift+Cmd+Z" : "Ctrl+Y"),
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    { label: "Format", submenu: [item("bold", "Bold", "CmdOrCtrl+B")] },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return {
    /** Enablement driven by the renderer's `can().undo()` / `can().redo()`. */
    setHistory(canUndo: boolean, canRedo: boolean) {
      const undo = menu.getMenuItemById("undo");
      const redo = menu.getMenuItemById("redo");
      if (undo) undo.enabled = canUndo;
      if (redo) redo.enabled = canRedo;
    },
    state() {
      return {
        undo: menu.getMenuItemById("undo")?.enabled ?? null,
        redo: menu.getMenuItemById("redo")?.enabled ?? null,
      };
    },
  };
}
