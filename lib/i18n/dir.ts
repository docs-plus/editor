/**
 * The eager locale facts `t-core.ts` needs (languages design §3.2, §4.1):
 * the source language and the direction of a locale. Kept apart from
 * `locale.ts` (matching, native names, the pseudo-locale flag), which only
 * lazy chunks import, so the editor chunk pays for this file alone.
 */

/** English is the source language: messages are written in code. */
export const SOURCE_LOCALE = "en";

export type TextDirection = "ltr" | "rtl";

/**
 * Scripts written right to left: Arabic (and its Nastaliq form, which
 * `ur` and `ks` maximize to), Hebrew, Thaana, Syriac, N'Ko, Adlam and
 * Hanifi Rohingya.
 */
const RTL_SCRIPT = /^(Arab|Aran|Hebr|Thaa|Syrc|Nkoo|Adlm|Rohg)$/;

/**
 * The interface direction for a locale, from its likely script, so a tag
 * like `ku-Arab` or `pa-Arab` is `rtl` while `ku` stays `ltr` (`ar-XB` is
 * Arabic, so `rtl`). A malformed tag is `ltr`.
 */
export function dirOf(locale: string): TextDirection {
  try {
    const { script } = new Intl.Locale(locale).maximize();
    return RTL_SCRIPT.test(script ?? "") ? "rtl" : "ltr";
  } catch {
    return "ltr";
  }
}
