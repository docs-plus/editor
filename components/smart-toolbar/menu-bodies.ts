/**
 * The menu chunk (owner decision O1): every toolbar menu's popup and
 * items, behind one dynamic import (`lazy-menu.tsx`). One chunk for all
 * menus: each lazy chunk costs the editor chunk a loader, and splitting
 * the menus apart would split the Base UI menu parts they share.
 */
export { ListMenuContent } from "@/components/tiptap-ui/list-dropdown-menu/list-dropdown-menu-content";

export {
  AaMenuItems,
  ParagraphMenuItems,
  SizeMenuItems,
  SlotMenuItems,
  ViewMenuItems,
} from "./collapse-menu-bodies";
export { LanguageMenuItems } from "./context-slot/slot-menu-bodies";
export { InsertMenuContent } from "./insert/insert-menu-body";
export { PhoneListMenuItems } from "./phone/phone-menu-bodies";
export { ActionMenuItems, ToolbarMenuContent } from "./row/menu-items";
export {
  AlignMenuItems,
  OverflowMenuItems,
  StyleMenuItems,
} from "./row/row-menu-bodies";
