/**
 * The production menu (UX design §2.3, §2.4). It has no Reload, Force
 * Reload, Toggle DevTools or zoom items, so their accelerators don't exist.
 * The Edit menu keeps the clipboard roles: on macOS ⌘C and ⌘V only reach
 * the page through it. Undo and Redo arrive with the menu intents in P2.9a
 * (they must run Yjs undo, not the native one, S1).
 */
import { Menu, type MenuItemConstructorOptions } from "electron";

const editMenu: MenuItemConstructorOptions = {
  label: "Edit",
  submenu: [
    { role: "cut" },
    { role: "copy" },
    { role: "paste" },
    { role: "pasteAndMatchStyle" },
    { role: "delete" },
    { type: "separator" },
    { role: "selectAll" },
  ],
};

export function installMenu(): void {
  const template: MenuItemConstructorOptions[] =
    process.platform === "darwin"
      ? [
          {
            role: "appMenu",
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
          editMenu,
          {
            role: "windowMenu",
            submenu: [
              { role: "minimize" },
              { role: "zoom" },
              { type: "separator" },
              { role: "front" },
              { role: "close" },
            ],
          },
        ]
      : [
          { label: "File", submenu: [{ role: "close" }, { role: "quit" }] },
          editMenu,
        ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
