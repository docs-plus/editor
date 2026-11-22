/**
 * Prints in the light theme (details spec E6): paper is light, and the dark
 * theme's light ink (body text, code, tables, highlights) would vanish on
 * it. The `dark` class comes off for the print and goes back after it.
 * `beforeprint` and `afterprint` also fire for Electron's
 * `webContents.print()`. Only the class changes: the stored preference,
 * the title-bar colour and the theme event stay as they are. Mounted once
 * per page (`ThemeRuntime`); returns the unsubscribe.
 */
export function watchPrintTheme(): () => void {
  const root = document.documentElement.classList;
  let restoreDark = false;
  const beforePrint = () => {
    restoreDark = root.contains("dark");
    if (restoreDark) root.remove("dark");
  };
  const afterPrint = () => {
    if (restoreDark) root.add("dark");
    restoreDark = false;
  };
  window.addEventListener("beforeprint", beforePrint);
  window.addEventListener("afterprint", afterPrint);
  return () => {
    window.removeEventListener("beforeprint", beforePrint);
    window.removeEventListener("afterprint", afterPrint);
  };
}
