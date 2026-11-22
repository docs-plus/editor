/**
 * True where the CSS Custom Highlight API exists (Chromium 105, Safari
 * 17.2, Firefox 140). Its own module so the app shell can gate Find on it
 * without pulling in the painter.
 */
export function supportsHighlights(): boolean {
  return (
    typeof CSS !== "undefined" &&
    "highlights" in CSS &&
    typeof Highlight === "function"
  );
}
