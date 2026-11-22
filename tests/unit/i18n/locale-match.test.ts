/**
 * Locale resolution and direction (languages design §6.1, §4.1, §3.12).
 */
import { afterEach, describe, expect, it } from "bun:test";

import {
  availableLocales,
  dirOf,
  matchLocale,
  nativeName,
  PSEUDO_LOCALES,
  SHIPPED_LOCALES,
  SOURCE_LOCALE,
} from "@/lib/i18n/locale";
import { importFresh, resetModules } from "@/tests/helpers/import-fresh";

describe("matchLocale (BCP 47 lookup)", () => {
  const shipped = ["en", "fa", "pt-BR"];

  it("matches a region to its language", () => {
    expect(matchLocale(["fa-AF"], shipped)).toBe("fa");
    expect(matchLocale(["fa-IR", "en"], shipped)).toBe("fa");
  });

  it("falls back to English when nothing matches", () => {
    expect(matchLocale(["zh-TW"], shipped)).toBe(SOURCE_LOCALE);
    expect(matchLocale([], shipped)).toBe(SOURCE_LOCALE);
  });

  it("tries each requested language in order", () => {
    expect(matchLocale(["zh-TW", "fa"], shipped)).toBe("fa");
  });

  it("never matches pt-PT to a pt-BR-only catalog", () => {
    expect(matchLocale(["pt-PT"], shipped)).toBe(SOURCE_LOCALE);
    expect(matchLocale(["pt-br"], shipped)).toBe("pt-BR");
  });

  it("ignores malformed tags", () => {
    expect(matchLocale(["not a tag!", "fa"], shipped)).toBe("fa");
  });
});

describe("dirOf", () => {
  it("is rtl for Arabic-script and Hebrew languages and ar-XB", () => {
    for (const locale of ["fa", "fa-AF", "ar", "ar-EG", "he", "ur", "ar-XB"]) {
      expect(dirOf(locale)).toBe("rtl");
    }
  });

  it("is ltr otherwise", () => {
    for (const locale of ["en", "en-XA", "fr", "ru", "zh-TW", "nonsense!"]) {
      expect(dirOf(locale)).toBe("ltr");
    }
  });
});

describe("nativeName", () => {
  it("names each language in its own script", () => {
    expect(nativeName("en")).toBe("English");
    expect(nativeName("fa")).toBe("فارسی");
    expect(nativeName("he")).toBe("עברית");
  });

  it("names the pseudo-locales plainly", () => {
    expect(nativeName("en-XA")).toBe("Pseudo (accented)");
    expect(nativeName("ar-XB")).toBe("Pseudo (right to left)");
  });
});

describe("pseudo-locales flag (NEXT_PUBLIC_PSEUDO_LOCALES)", () => {
  const previous = process.env.NEXT_PUBLIC_PSEUDO_LOCALES;
  afterEach(() => {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_PSEUDO_LOCALES;
    else process.env.NEXT_PUBLIC_PSEUDO_LOCALES = previous;
    resetModules();
  });

  it("is off by default: v1 ships English alone", async () => {
    delete process.env.NEXT_PUBLIC_PSEUDO_LOCALES;
    const fresh =
      await importFresh<typeof import("@/lib/i18n/locale")>(
        "@/lib/i18n/locale",
      );
    expect(fresh.PSEUDO_LOCALES_ENABLED).toBe(false);
    expect(fresh.availableLocales()).toEqual(["en"]);
    expect(fresh.matchLocale(["en-XA"])).toBe("en");
  });

  it("adds en-XA and ar-XB only when set to 1", async () => {
    process.env.NEXT_PUBLIC_PSEUDO_LOCALES = "1";
    const fresh =
      await importFresh<typeof import("@/lib/i18n/locale")>(
        "@/lib/i18n/locale",
      );
    expect(fresh.PSEUDO_LOCALES_ENABLED).toBe(true);
    expect(fresh.availableLocales()).toEqual(["en", "en-XA", "ar-XB"]);
    expect(fresh.matchLocale(["en-XA"])).toBe("en-XA");
  });

  it("ships English alone in v1 (D26)", () => {
    expect(SHIPPED_LOCALES).toEqual(["en"]);
    expect(PSEUDO_LOCALES).toEqual(["en-XA", "ar-XB"]);
    expect(availableLocales()).toEqual(["en"]);
  });
});
