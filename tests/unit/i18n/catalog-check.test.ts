/**
 * `scripts/i18n/check.ts` (languages design §3.11, §8.1) on the real
 * catalogs, and on fixtures for each rule. `bun run test` runs this in CI,
 * so a stale `locales/en` fails the checks job: run `bun run i18n:extract`.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { sourceHash } from "@/scripts/i18n/catalog";
import { checkCatalogs } from "@/scripts/i18n/check";
import { registryActions } from "@/scripts/i18n/extract";

const ROOT = join(import.meta.dir, "..", "..", "..");

describe("the real catalogs", () => {
  it("are fresh and valid (else run `bun run i18n:extract`)", async () => {
    const actions = await registryActions();
    const result = checkCatalogs(ROOT, { actions });
    expect(result.errors).toEqual([]);
  });
});

const roots: string[] = [];
function fixture(files: Record<string, unknown>): string {
  const root = mkdtempSync(join(tmpdir(), "i18n-check-"));
  roots.push(root);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(
      join(root, path),
      typeof body === "string" ? body : JSON.stringify(body),
    );
  }
  return root;
}
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

const ACTIONS = [{ id: "mark.bold", label: "Bold", shortcut: "Mod-b" }];
const EN_ACTIONS = { "action.mark.bold.label": "Bold" };
const DOCS = "{count, plural, one {# document} other {# documents}}";
const IMPORT = `import { t } from "@/lib/i18n/format";\n`;

function check(files: Record<string, unknown>, actions = ACTIONS) {
  return checkCatalogs(fixture(files), { actions });
}

describe("checkCatalogs: the English source", () => {
  it("passes a fresh catalog", () => {
    expect(check({ "locales/en/actions.json": EN_ACTIONS }).errors).toEqual([]);
  });

  it("fails a stale, missing or extra catalog", () => {
    expect(
      check({ "locales/en/actions.json": { "action.mark.bold.label": "B" } })
        .errors[0],
    ).toContain("i18n:extract");
    expect(check({}).errors[0]).toContain("actions.json");
    const extra = check({
      "locales/en/actions.json": EN_ACTIONS,
      "locales/en/print.json": { "print.x": "X" },
    });
    expect(extra.errors.join("\n")).toContain("print.json");
  });

  it("fails stale notes", () => {
    const root = {
      "components/a.tsx": `${IMPORT}// i18n: A note.\nt("library.a", "A");\n`,
      "locales/en/actions.json": EN_ACTIONS,
      "locales/en/library.json": { "library.a": "A" },
    };
    expect(check(root).errors.join("\n")).toContain("library.notes.json");
  });

  it("bans shortcut glyphs, Ctrl+ and straight double quotes", () => {
    for (const bad of ["Press ⌘B", "Press Ctrl+B", 'Say "hi"']) {
      const errors = check(
        { "locales/en/actions.json": { "action.mark.bold.label": bad } },
        [{ id: "mark.bold", label: bad, shortcut: "Mod-b" }],
      ).errors;
      expect(errors.join("\n")).toContain("banned");
    }
  });

  it("keeps the core namespace to {name}", () => {
    const errors = check({
      "components/a.tsx": `${IMPORT}t("core.count", "${DOCS}");\n`,
      "locales/en/actions.json": EN_ACTIONS,
      "locales/en/core.json": { "core.count": DOCS },
    }).errors;
    expect(errors.join("\n")).toContain("core");
  });

  it("keeps ICU apostrophe escapes out of core (t-core prints them raw)", () => {
    for (const bad of ["l''élément", "Type '{'name'}'"]) {
      const errors = check({
        "components/a.tsx": `${IMPORT}t("core.x", ${JSON.stringify(bad)});\n`,
        "locales/en/actions.json": EN_ACTIONS,
        "locales/en/core.json": { "core.x": bad },
      }).errors;
      expect(errors.join("\n")).toContain("apostrophe");
    }
    const plain = check({
      "components/a.tsx": `${IMPORT}t("core.x", "Don't save");\n`,
      "locales/en/actions.json": EN_ACTIONS,
      "locales/en/core.json": { "core.x": "Don't save" },
    });
    expect(plain.errors).toEqual([]);
  });

  it("refuses reserved combos in the registry (Shift+Space types ZWNJ)", () => {
    const errors = check({ "locales/en/actions.json": EN_ACTIONS }, [
      { id: "mark.bold", label: "Bold", shortcut: "Shift-Space" },
    ]).errors;
    expect(errors.join("\n")).toContain("Shift-Space");
  });
});

describe("checkCatalogs: translations", () => {
  const base = {
    "components/a.tsx": `${IMPORT}t("library.count", "${DOCS}");\nt("library.moved", "Moved {title}");\n`,
    "locales/en/actions.json": EN_ACTIONS,
    "locales/en/library.json": {
      "library.count": DOCS,
      "library.moved": "Moved {title}",
    },
  };
  const entry = (text: string, english: string) => ({
    text,
    src: sourceHash(english),
  });

  it("passes a complete, current translation", () => {
    const result = check({
      ...base,
      "locales/fa/library.json": {
        "library.count": entry(
          "{count, plural, one {# سند} other {# سند}}",
          DOCS,
        ),
        "library.moved": entry("{title} منتقل شد", "Moved {title}"),
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("warns, but ships, a stale translation", () => {
    const result = check({
      ...base,
      "locales/fa/library.json": {
        "library.moved": entry("{title} منتقل شد", "Old English"),
      },
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join("\n")).toContain("stale");
  });

  it("fails missing plural categories, placeholder drift and orphans", () => {
    const result = check({
      ...base,
      "locales/ar/library.json": {
        "library.count": entry("{count, plural, one {#} other {#}}", DOCS),
        "library.moved": entry("نقل {name}", "Moved {title}"),
        "library.gone": entry("x", "x"),
      },
    });
    const text = result.errors.join("\n");
    expect(text).toContain("zero");
    expect(text).toContain("placeholders");
    expect(text).toContain("library.gone");
  });

  it("fails a translation filed under another namespace", () => {
    const result = check({
      ...base,
      "locales/fa/menus.json": {
        "library.moved": entry("{title} منتقل شد", "Moved {title}"),
      },
    });
    expect(result.errors.join("\n")).toContain(
      `locales/fa/menus.json: "library.moved" belongs in library.json`,
    );
  });

  it("fails ICU apostrophe escapes in a core translation", () => {
    const core = {
      "components/a.tsx": `${IMPORT}t("core.item", "the item");\nt("core.type", "Type {name}");\n`,
      "locales/en/actions.json": EN_ACTIONS,
      "locales/en/core.json": {
        "core.item": "the item",
        "core.type": "Type {name}",
      },
    };
    const result = check({
      ...core,
      "locales/fr/core.json": {
        "core.item": entry("l''élément", "the item"),
        "core.type": entry("Tapez '{'{name}", "Type {name}"),
      },
    });
    const text = result.errors.join("\n");
    expect(text).toContain(
      `"core.item": core messages can't use ICU apostrophe`,
    );
    expect(text).toContain(
      `"core.type": core messages can't use ICU apostrophe`,
    );
  });

  it("fails invalid ICU, bad entries and unknown namespaces", () => {
    const result = check({
      ...base,
      "locales/fa/library.json": {
        "library.count": entry("{count, plural, one {#}", DOCS),
        "library.moved": "plain string",
      },
      "locales/fa/nope.json": {},
    });
    const text = result.errors.join("\n");
    expect(text).toContain("library.count");
    expect(text).toContain("library.moved");
    expect(text).toContain("nope.json");
  });
});
