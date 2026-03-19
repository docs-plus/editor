/** Playwright `keyboard.press` modifier — `Meta` on macOS, `Control` elsewhere. */
export function getPlaywrightModifierKey(): "Meta" | "Control" {
  return process.platform === "darwin" ? "Meta" : "Control";
}
