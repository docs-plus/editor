import {
  PAGE_PROPERTIES,
  type PageProperties,
  PREF_ATTRIBUTES,
  type PrefAttributes,
} from "@/lib/prefs/schema";

/**
 * Writes the preference attributes and the card's inline knob variables on
 * `<html>` (§5.1), the same set the boot script writes. Only what differs
 * is touched, so the first re-apply after the boot script changes nothing
 * and lays out nothing.
 */
export function applyPrefs(
  attributes: PrefAttributes,
  properties: PageProperties = {},
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
  for (const name of PAGE_PROPERTIES) {
    const value = properties[name] ?? "";
    if (root.style.getPropertyValue(name) !== value) {
      if (value) root.style.setProperty(name, value);
      else root.style.removeProperty(name);
    }
  }
}
