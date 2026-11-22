import { PREF_ATTRIBUTES, type PrefAttributes } from "@/lib/prefs/schema";

/**
 * Writes the preference attributes on `<html>` (§5.1), the same set the
 * boot script writes. Only attributes that differ are touched, so the
 * first re-apply after the boot script changes nothing and lays out
 * nothing.
 */
export function applyPrefs(
  attributes: PrefAttributes,
  root: HTMLElement = document.documentElement,
): void {
  for (const name of PREF_ATTRIBUTES) {
    const value = attributes[name];
    if (value === undefined) {
      if (root.hasAttribute(name)) root.removeAttribute(name);
    } else if (root.getAttribute(name) !== value) {
      root.setAttribute(name, value);
    }
  }
}
