/**
 * The ICU MessageFormat 1 subset (languages design §3.4): `{name}`,
 * `plural` (exact `=n`, CLDR categories, `#`), `select`, `number`, `date`,
 * `time` and rich tags. `selectordinal` and nested plurals are rejected.
 */
import { afterEach, describe, expect, it } from "bun:test";

import {
  formatMessage,
  formatMessageParts,
  MessageSyntaxError,
  messageArguments,
  parseMessage,
  pluralCategoriesUsed,
  t,
} from "@/lib/i18n/format";
import { addMessages, setUiLocale } from "@/lib/i18n/t-core";

const DOCS =
  "{count, plural, =0 {No documents} one {# document} other {# documents}}";

describe("formatMessage: arguments", () => {
  it("returns plain text unchanged", () => {
    expect(formatMessage("Trash is empty", {}, "en")).toBe("Trash is empty");
  });

  it("interpolates {name}", () => {
    expect(
      formatMessage(
        "Moved “{title}” to {folder}",
        { title: "Q4", folder: "Work" },
        "en",
      ),
    ).toBe("Moved “Q4” to Work");
  });

  it("leaves a missing argument visible as {name}", () => {
    expect(formatMessage("Hello {name}", {}, "en")).toBe("Hello {name}");
  });

  it("isolates arguments with FSI…PDI only when asked", () => {
    expect(
      formatMessage("“{title}”", { title: "سلام" }, "en", { isolate: true }),
    ).toBe("“\u2068سلام\u2069”");
  });
});

describe("formatMessage: plural", () => {
  it("prefers =0 over a CLDR category", () => {
    expect(formatMessage(DOCS, { count: 0 }, "en")).toBe("No documents");
  });

  it("picks one and other in English, with # formatted", () => {
    expect(formatMessage(DOCS, { count: 1 }, "en")).toBe("1 document");
    expect(formatMessage(DOCS, { count: 1200 }, "en")).toBe("1,200 documents");
  });

  it("formats # with the locale's digits", () => {
    const fa = "{n, plural, one {# سند} other {# سند}}";
    expect(formatMessage(fa, { n: 3 }, "fa")).toBe("۳ سند");
  });

  it("falls back to other when a category is missing", () => {
    expect(formatMessage("{n, plural, other {# x}}", { n: 1 }, "en")).toBe(
      "1 x",
    );
  });

  const CATEGORIES: [string, number][] = [
    ["ar", 6],
    ["he", 3],
    ["fa", 2],
    ["ru", 4],
    ["fr", 3],
  ];
  for (const [locale, size] of CATEGORIES) {
    it(`selects every CLDR category of ${locale} (${size})`, () => {
      const categories = new Intl.PluralRules(locale).resolvedOptions()
        .pluralCategories;
      expect(categories.length).toBe(size);
      const message = `{n, plural, ${categories.map((c) => `${c} {${c}}`).join(" ")}}`;
      const rules = new Intl.PluralRules(locale);
      for (const n of [0, 1, 2, 3, 5, 11, 100, 1.5]) {
        expect(formatMessage(message, { n }, locale)).toBe(rules.select(n));
      }
    });
  }
});

describe("formatMessage: select, number, date, time", () => {
  it("selects by value, then other", () => {
    const m = "{platform, select, mac {New Document} other {New document}}";
    expect(formatMessage(m, { platform: "mac" }, "en")).toBe("New Document");
    expect(formatMessage(m, { platform: "win" }, "en")).toBe("New document");
  });

  it("formats numbers, percent and compact", () => {
    expect(formatMessage("{n, number}", { n: 1234.5 }, "en")).toBe("1,234.5");
    expect(formatMessage("{n, number, percent}", { n: 0.25 }, "en")).toBe(
      "25%",
    );
    expect(formatMessage("{n, number, compact}", { n: 1500 }, "en")).toBe(
      "1.5K",
    );
    expect(formatMessage("{n, number, integer}", { n: 2.6 }, "en")).toBe("3");
  });

  it("formats dates and times through Intl", () => {
    const when = new Date(Date.UTC(2026, 10, 16, 12));
    const expected = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
    }).format(when);
    expect(formatMessage("{when, date, medium}", { when }, "en-GB")).toBe(
      expected,
    );
    const time = new Intl.DateTimeFormat("en", { timeStyle: "short" }).format(
      when,
    );
    expect(formatMessage("{when, time, short}", { when }, "en")).toBe(time);
  });
});

describe("formatMessageParts: rich tags", () => {
  it("passes tag children to the caller's renderer", () => {
    const parts = formatMessageParts(
      "Read <link>the backup guide</link>.",
      { link: (children: string) => ({ a: children }) },
      "en",
    );
    expect(parts).toEqual(["Read ", { a: "the backup guide" }, "."]);
  });

  it("keeps tag text when no renderer is given", () => {
    expect(formatMessage("Read <link>the guide</link>", {}, "en")).toBe(
      "Read the guide",
    );
  });

  it("treats a lone < as text", () => {
    expect(formatMessage("a < b", {}, "en")).toBe("a < b");
  });
});

describe("parseMessage: apostrophes", () => {
  it("keeps a plain apostrophe and unescapes '' and '{…}'", () => {
    expect(formatMessage("isn't", {}, "en")).toBe("isn't");
    expect(formatMessage("a '{literal}' b", {}, "en")).toBe("a {literal} b");
    expect(formatMessage("it''s", {}, "en")).toBe("it's");
  });
});

describe("parseMessage: errors", () => {
  const bad = [
    "{count, selectordinal, one {#st} other {#th}}",
    "{n, plural, one {{m, plural, one {x} other {y}}} other {z}}",
    "{n, plural, one {x}}",
    "{n, plural, lots {x} other {y}}",
    "{s, select, a {x}}",
    "{unclosed",
    "<b>no close",
    "{n, number, scientific}",
    "{n, plural, offset:1 one {x} other {y}}",
  ];
  for (const message of bad) {
    it(`rejects ${message}`, () => {
      expect(() => parseMessage(message)).toThrow(MessageSyntaxError);
    });
  }
});

describe("message analysis (for check.ts)", () => {
  it("lists argument and tag names", () => {
    expect([...messageArguments(`<link>{name}</link> ${DOCS}`)].sort()).toEqual(
      ["<link>", "count", "name"],
    );
  });

  it("lists the plural categories each plural uses", () => {
    expect(pluralCategoriesUsed(DOCS)).toEqual([
      { name: "count", categories: ["one", "other"] },
    ]);
  });
});

describe("formatMessage: values are own properties only", () => {
  it("never reads Object.prototype for {name} or tags", () => {
    expect(formatMessage("Hi {toString}", {}, "en")).toBe("Hi {toString}");
    expect(
      formatMessageParts("<constructor>x</constructor>", {}, "en"),
    ).toEqual(["x"]);
  });

  it("keeps a missing number, date, time or plural count visible", () => {
    expect(formatMessage("{n, number} left", {}, "en")).toBe("{n} left");
    expect(formatMessage("On {d, date, short}", {}, "en")).toBe("On {d}");
    expect(formatMessage("At {d, time}", {}, "en")).toBe("At {d}");
    expect(
      formatMessage("{n, plural, one {# doc} other {# docs}}", {}, "en"),
    ).toBe("# docs");
  });
});

describe("t (lazy chunks)", () => {
  afterEach(() => setUiLocale("en"));

  it("formats a translation in the interface locale, isolating values", () => {
    setUiLocale("fa");
    addMessages({ "library.moved": "«{title}» منتقل شد" });
    expect(t("library.moved", "Moved “{title}”", { title: "Q4" })).toBe(
      "«⁨Q4⁩» منتقل شد",
    );
  });

  it("renders English, not an error, for a malformed translation", () => {
    setUiLocale("fa");
    addMessages({ "library.count": "{count, plural, one {# سند}" });
    expect(t("library.count", DOCS, { count: 2 })).toBe("۲ documents");
  });

  it("still throws for malformed English (check.ts rejects it first)", () => {
    expect(() => t("library.bad", "{count, plural, one {x}")).toThrow(
      MessageSyntaxError,
    );
  });
});
