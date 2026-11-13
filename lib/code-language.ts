/**
 * Allowed shape of a code block `language` attribute: one identifier-like
 * token (`ts`, `c++`, `c#`, `objective-c`, `vb.net`). Anything else could
 * smuggle extra class tokens into the rendered `<code>` element.
 */
export const SAFE_CODE_LANGUAGE = /^[A-Za-z0-9_+#.-]{1,40}$/;

/** Returns `value` when it is a safe language name, otherwise `null`. */
export function sanitizeCodeLanguage(value: unknown): string | null {
  return typeof value === "string" && SAFE_CODE_LANGUAGE.test(value)
    ? value
    : null;
}
