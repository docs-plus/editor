import { THEME_COLOR_DARK } from "@/lib/site-config";
import {
  LEGACY_KEY_PREFIX,
  SYSTEM_DARK_QUERY,
  THEME_COLOR_META_ID,
  THEME_PREFERENCES,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

/*
 * Kept apart from `lib/theme.ts`, which the editor chunk imports: only the
 * root layout needs this string.
 */

/**
 * Inline <body> script: resolves the theme preference (a missing or invalid
 * one becomes the §5.6 fallback and is written at once, so a new visitor who
 * reloads is not misread as a returning one), then applies a dark theme and
 * its title-bar colour before first paint, mirroring `applyTheme(true)`.
 * Blocked storage follows the OS.
 */
export const THEME_BOOT_SCRIPT = `(function(){var k=${JSON.stringify(THEME_STORAGE_KEY)},p=${JSON.stringify(THEME_PREFERENCES)},x=${JSON.stringify(LEGACY_KEY_PREFIX)},t=null;try{t=localStorage.getItem(k);if(p.indexOf(t)<0){t="system";for(var i=0;i<localStorage.length;i++){var n=localStorage.key(i);if(n!==k&&n.indexOf(x)===0){t="light";break}}localStorage.setItem(k,t)}}catch(e){if(p.indexOf(t)<0)t="system"}try{if(t==="dark"||(t==="system"&&matchMedia(${JSON.stringify(SYSTEM_DARK_QUERY)}).matches)){document.documentElement.classList.add("dark");var m=document.createElement("meta");m.name="theme-color";m.id=${JSON.stringify(THEME_COLOR_META_ID)};m.content=${JSON.stringify(THEME_COLOR_DARK)};document.head.prepend(m)}}catch(e){}})();`;
