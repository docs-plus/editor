"use client";

// By file, not through `@base-ui/react/menu`: that entry is one `Menu`
// namespace barrel, and Turbopack puts every part the app uses through it
// (popup, positioner, items, submenus) in the first chunk that imports it.
// These are the same modules the barrel re-exports, so contexts match.
import { MenuRoot } from "../../node_modules/@base-ui/react/menu/root/MenuRoot.mjs";
import { MenuTrigger } from "../../node_modules/@base-ui/react/menu/trigger/MenuTrigger.mjs";

/**
 * The parts of `dropdown-menu.tsx` a closed menu needs: the root and its
 * trigger. Eager code (the editor chunk) imports only these; the popup,
 * positioner and items stay in the lazy chunks that render them (owner
 * decision O1).
 */
function DropdownMenu({ ...props }: MenuRoot.Props) {
  return <MenuRoot data-slot="dropdown-menu" {...props} />;
}

function DropdownMenuTrigger({ ...props }: MenuTrigger.Props) {
  return <MenuTrigger data-slot="dropdown-menu-trigger" {...props} />;
}

export { DropdownMenu, DropdownMenuTrigger };
