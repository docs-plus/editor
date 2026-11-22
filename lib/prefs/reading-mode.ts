/**
 * Reading mode (preferences design §2.1 row 13): per window or tab, never
 * stored, so it resets when the tab closes. It is `data-reading` on
 * `<html>`: `PageFrame` watches the attribute and makes the document
 * read-only through the editor's `readOnly` prop (WriteGate and
 * `setEditable`), and CSS hides the toolbar, so reading writes nothing.
 */

const ATTRIBUTE = "data-reading";

export const isReadingMode = (): boolean =>
  document.documentElement.hasAttribute(ATTRIBUTE);

export function setReadingMode(on: boolean): void {
  document.documentElement.toggleAttribute(ATTRIBUTE, on);
}
