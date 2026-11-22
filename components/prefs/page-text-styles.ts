/**
 * The document text's page rules (`styles/_page-text.scss`), loaded with
 * the editor instead of with the page: the editor's loader imports this
 * module next to the editor and renders once `ready()` resolves
 * (`editor-app.tsx`). Any other host that mounts `DocumentEditor` loads it
 * the same way.
 */
import "@/styles/_page-text.scss";

/**
 * Safari can apply a lazy stylesheet a moment after its import resolved:
 * waits until every loaded `<link rel=stylesheet>` applies, for at most
 * 1.5 s. The same check as `lib/styles-applied.ts`, kept apart on purpose:
 * a module this chunk and the editor's both import is split into a chunk
 * of its own, which costs the editor chunk bytes.
 */
export const ready = (): Promise<void> =>
  new Promise((resolve) => {
    const start = performance.now();
    const check = () => {
      const active = Array.from(document.styleSheets);
      const applied = Array.from(
        document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]'),
      ).every(({ sheet }) => !sheet || active.includes(sheet));
      if (applied || performance.now() - start > 1500) resolve();
      else requestAnimationFrame(check);
    };
    check();
  });
