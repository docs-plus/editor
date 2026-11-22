/**
 * The eager `t()` (languages design §3.2, §3.3): lookup with English as the
 * source of truth, `{name}` interpolation, the interface locale and `dir`,
 * and the registry render boundary.
 */
import { afterEach, describe, expect, it } from "bun:test";

import {
  actionKeywords,
  actionLabel,
  reasonText,
} from "@/lib/i18n/registry-labels";
import {
  addMessages,
  lookup,
  setUiLocale,
  shouldIsolate,
  t,
  uiDir,
  uiLocale,
} from "@/lib/i18n/t-core";

afterEach(() => setUiLocale("en"));

describe("t (English)", () => {
  it("starts in English, left to right", () => {
    expect(uiLocale()).toBe("en");
    expect(uiDir()).toBe("ltr");
    expect(shouldIsolate()).toBe(false);
  });

  it("returns the English source with no catalog", () => {
    expect(t("library.trash.empty", "Trash is empty")).toBe("Trash is empty");
  });

  it("interpolates {name} and adds no isolates in English", () => {
    expect(
      t("library.moved", "Moved “{title}” to {folder}", {
        title: "Q4",
        folder: "Work",
      }),
    ).toBe("Moved “Q4” to Work");
  });

  it("leaves a missing value visible", () => {
    expect(t("core.hi", "Hi {name}")).toBe("Hi {name}");
  });

  it("ignores catalogs while the interface is English", () => {
    addMessages({ "library.trash.empty": "خالی" });
    expect(lookup("library.trash.empty")).toBeUndefined();
  });
});

describe("t (another locale)", () => {
  it("uses the catalog, sets dir and isolates values", () => {
    setUiLocale("fa");
    addMessages({ "library.moved": "«{title}» به {folder} رفت" });
    expect(uiDir()).toBe("rtl");
    expect(
      t("library.moved", "Moved “{title}” to {folder}", {
        title: "Q4",
        folder: "کار",
      }),
    ).toBe("«\u2068Q4\u2069» به \u2068کار\u2069 رفت");
  });

  it("falls back to English for a missing message", () => {
    setUiLocale("fa");
    expect(t("library.trash.empty", "Trash is empty")).toBe("Trash is empty");
  });

  it("drops the catalog when the locale changes", () => {
    setUiLocale("fa");
    addMessages({ "core.k": "x" });
    setUiLocale("he");
    expect(lookup("core.k")).toBeUndefined();
  });
});

describe("registry render boundary", () => {
  const action = { id: "mark.bold", label: "Bold", keywords: ["strong"] };

  it("returns the registry's English with no catalog", () => {
    expect(actionLabel(action)).toBe("Bold");
    expect(actionKeywords(action)).toEqual(["strong"]);
    expect(actionKeywords({ id: "x", label: "X" })).toEqual([]);
    expect(reasonText("This document is read-only.")).toBe(
      "This document is read-only.",
    );
  });

  it("looks labels, keywords and reasons up by id and English text", () => {
    setUiLocale("fa");
    addMessages({
      "action.mark.bold.label": "پررنگ",
      "action.mark.bold.keywords": "ضخیم, سیاه",
      "reason:This document is read-only.": "این سند فقط\u200Cخواندنی است.",
    });
    expect(actionLabel(action)).toBe("پررنگ");
    expect(actionKeywords(action)).toEqual(["ضخیم", "سیاه"]);
    expect(reasonText("This document is read-only.")).toBe(
      "این سند فقط\u200Cخواندنی است.",
    );
  });
});
