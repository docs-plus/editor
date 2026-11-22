/**
 * Supported interface languages, BCP 47 matching and direction per locale
 * (languages design §3.2, §4.1, §6.1). v1 ships English alone (D26); the
 * pseudo-locales `en-XA` and `ar-XB` (§3.12) exist only when
 * `NEXT_PUBLIC_PSEUDO_LOCALES=1` (dev, CI and preview builds), off by
 * default and never set in production.
 */

/** English is the source language: messages are written in code. */
export const SOURCE_LOCALE = "en";

/** Languages with a reviewed catalog (each L8.x adds one). */
export const SHIPPED_LOCALES: readonly string[] = [SOURCE_LOCALE];

/** Accented and expanded (`en-XA`), and reversed right to left (`ar-XB`). */
export const PSEUDO_LOCALES: readonly string[] = ["en-XA", "ar-XB"];

export const PSEUDO_LOCALES_ENABLED =
  process.env.NEXT_PUBLIC_PSEUDO_LOCALES?.trim() === "1";

/** Languages this build can show: shipped, plus the pseudo-locales when on. */
export function availableLocales(): readonly string[] {
  return PSEUDO_LOCALES_ENABLED
    ? [...SHIPPED_LOCALES, ...PSEUDO_LOCALES]
    : SHIPPED_LOCALES;
}

function canonical(tag: string): string | null {
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * RFC 4647 lookup: for each requested tag in order, drop subtags from the
 * end until one names an available locale (`fa-AF` → `fa`). A more specific
 * catalog never answers a less specific request (`pt-PT` never gets `pt-BR`).
 * Falls back to English.
 */
export function matchLocale(
  requested: readonly string[],
  available: readonly string[] = availableLocales(),
): string {
  const byLower = new Map(
    available.map((locale) => [locale.toLowerCase(), locale]),
  );
  for (const tag of requested) {
    let candidate = canonical(tag)?.toLowerCase();
    while (candidate) {
      const hit = byLower.get(candidate);
      if (hit) return hit;
      const cut = candidate.lastIndexOf("-");
      candidate = cut > 0 ? candidate.slice(0, cut) : undefined;
    }
  }
  return SOURCE_LOCALE;
}

/** Languages written right to left (Arabic script, Hebrew and others). */
const RTL_LANGUAGES = new Set([
  "ar",
  "ckb",
  "dv",
  "fa",
  "he",
  "ps",
  "sd",
  "ug",
  "ur",
  "yi",
]);

export type TextDirection = "ltr" | "rtl";

/** The interface direction for a locale (`ar-XB` is Arabic, so `rtl`). */
export function dirOf(locale: string): TextDirection {
  const tag = canonical(locale);
  if (!tag) return "ltr";
  return RTL_LANGUAGES.has(new Intl.Locale(tag).language) ? "rtl" : "ltr";
}

const PSEUDO_NAMES: Record<string, string> = {
  "en-XA": "Pseudo (accented)",
  "ar-XB": "Pseudo (right to left)",
};

/** A language's name in its own language, for the language row (§6.1). */
export function nativeName(locale: string): string {
  return (
    PSEUDO_NAMES[locale] ??
    new Intl.DisplayNames([locale], { type: "language" }).of(locale) ??
    locale
  );
}
