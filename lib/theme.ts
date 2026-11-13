import { THEME_COLOR, THEME_COLOR_DARK } from "@/lib/site-config";

export const THEME_STORAGE_KEY = "tinydocy-theme";

/** Fired on `window` after a control other than the row's toggle switches theme. */
export const THEME_CHANGE_EVENT = "tinydocy-theme-change";

/**
 * Our own theme-color meta, placed before the one Next renders from
 * `viewport.themeColor`. Browsers use the first match, and React never
 * touches this element: rewriting React's meta before hydration makes
 * React 19 insert a second, light one.
 */
export const THEME_COLOR_META_ID = "tinydocy-theme-color";

/**
 * Inline <body> script: applies the stored theme and its title-bar colour
 * before first paint, mirroring applyTheme(true).
 */
export const THEME_BOOT_SCRIPT = `(function(){try{if(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})==="dark"){document.documentElement.classList.add("dark");var m=document.createElement("meta");m.name="theme-color";m.id=${JSON.stringify(THEME_COLOR_META_ID)};m.content=${JSON.stringify(THEME_COLOR_DARK)};document.head.prepend(m)}}catch(e){}})();`;

function themeColorMeta(): HTMLMetaElement {
  const existing = document.getElementById(THEME_COLOR_META_ID);
  if (existing instanceof HTMLMetaElement) return existing;
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.id = THEME_COLOR_META_ID;
  document.head.prepend(meta);
  return meta;
}

/**
 * Toggles the class theme and the title-bar colour (installed windows,
 * Android and Safari browser chrome). The theme is a manual class toggle,
 * so a `prefers-color-scheme` theme-color would be wrong.
 */
export function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle("dark", dark);
  themeColorMeta().content = dark ? THEME_COLOR_DARK : THEME_COLOR;
}
