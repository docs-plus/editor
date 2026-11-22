/**
 * Catalog checks (languages design §3.4, §3.5, §3.11, §4.5):
 * `bun run i18n:check`, and `tests/unit/i18n/catalog-check.test.ts` in CI.
 *
 * Errors:
 * - `locales/en` differs from what `extract.ts` writes (stale, missing or
 *   extra catalogs and notes), or the extractor reports a problem;
 * - a message isn't valid in the ICU subset (`selectordinal`, nested
 *   plurals and `offset:` included);
 * - a `core` message uses more than `{name}` (the editor chunk has no
 *   formatter);
 * - a catalog contains ⌘ ⌥ ⇧ ⌃, `Ctrl+` or straight double quotes
 *   (shortcuts are placeholders, prose uses curly quotes);
 * - a plural leaves out a CLDR category its locale needs;
 * - a translation's placeholders or tags differ from the English, its
 *   entry isn't `{ text, src }`, its key no longer exists in English, or its
 *   file names no namespace;
 * - a registry shortcut is reserved (Shift+Space types ZWNJ on the Persian
 *   layout).
 *
 * Warnings: a translation made from older English (its `src` hash differs).
 * It still ships, which beats English mid-sentence; the coverage report
 * lists it.
 */
import { join } from "node:path";

import {
  isSimpleMessage,
  messageArguments,
  parseMessage,
  pluralCategoriesUsed,
} from "@/lib/i18n/format";
import {
  isNamespace,
  LOCALES_DIR,
  localeDirs,
  NOTES_SUFFIX,
  namespaceOf,
  readLocale,
  readNotes,
  SOURCE_LOCALE_DIR,
  sourceHash,
} from "@/scripts/i18n/catalog";
import {
  type ExtractableAction,
  extractMessages,
  registryActions,
} from "@/scripts/i18n/extract";

export interface CheckableAction extends ExtractableAction {
  readonly shortcut?: string;
}

export interface CheckResult {
  errors: string[];
  warnings: string[];
}

/** Combos no shortcut may bind (§4.5). */
export const RESERVED_COMBOS = ["Shift-Space"];

const BANNED: [RegExp, string][] = [
  [/[⌘⌥⇧⌃]/, "a shortcut glyph (use a {shortcut} placeholder)"],
  [/\bCtrl\+/i, "Ctrl+ (use a {shortcut} placeholder)"],
  [/"/, "a straight double quote (use “ ”)"],
];

const sameJson = (a: unknown, b: unknown) =>
  JSON.stringify(a, Object.keys(a ?? {}).sort()) ===
  JSON.stringify(b, Object.keys(b ?? {}).sort());

function diffKeys(
  want: Record<string, unknown>,
  have: Record<string, unknown>,
): string {
  const keys = new Set([...Object.keys(want), ...Object.keys(have)]);
  const changed = [...keys].filter((key) => want[key] !== have[key]).sort();
  const shown = changed.slice(0, 5).join(", ");
  return changed.length > 5 ? `${shown} and ${changed.length - 5} more` : shown;
}

export function checkCatalogs(
  root: string,
  { actions }: { actions: readonly CheckableAction[] },
): CheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const extraction = extractMessages(root, { actions });
  errors.push(...extraction.errors);
  const enDir = `${LOCALES_DIR}/${SOURCE_LOCALE_DIR}`;
  const rerun = "run `bun run i18n:extract`";

  // 1. The English source is what the extractor writes.
  const english = readLocale(root, SOURCE_LOCALE_DIR);
  for (const [ns, want] of extraction.catalogs) {
    const have = english.get(ns);
    if (!have) errors.push(`${enDir}/${ns}.json is missing: ${rerun}`);
    else if (!sameJson(want, have)) {
      errors.push(
        `${enDir}/${ns}.json is stale (${diffKeys(want, have)}): ${rerun}`,
      );
    }
  }
  for (const ns of english.keys()) {
    if (!extraction.catalogs.has(ns as never)) {
      errors.push(`${enDir}/${ns}.json has no messages in code: ${rerun}`);
    }
  }
  const notes = readNotes(root);
  const noteNamespaces = new Set([...extraction.notes.keys(), ...notes.keys()]);
  for (const ns of noteNamespaces) {
    const want = extraction.notes.get(ns as never) ?? {};
    if (!sameJson(want, notes.get(ns) ?? {})) {
      errors.push(`${enDir}/${ns}${NOTES_SUFFIX} is stale: ${rerun}`);
    }
  }

  // 2. Every message, English and translated, against the shared rules.
  const sourceText = new Map<string, string>();
  for (const catalog of extraction.catalogs.values()) {
    for (const [key, text] of Object.entries(catalog))
      sourceText.set(key, text);
  }
  const checkMessage = (locale: string, key: string, text: string) => {
    const at = `${LOCALES_DIR}/${locale}: "${key}"`;
    try {
      parseMessage(text);
    } catch (error) {
      errors.push(`${at}: ${(error as Error).message}`);
      return false;
    }
    for (const [pattern, what] of BANNED) {
      if (pattern.test(text)) errors.push(`${at}: banned ${what}`);
    }
    if (namespaceOf(key) === "core" && !isSimpleMessage(text)) {
      errors.push(
        `${at}: core messages use only {name} (no plural, select, number, date or tags)`,
      );
    }
    const needed = new Intl.PluralRules(locale).resolvedOptions()
      .pluralCategories;
    for (const plural of pluralCategoriesUsed(text)) {
      const missing = needed.filter(
        (category) => !plural.categories.includes(category),
      );
      if (missing.length) {
        errors.push(
          `${at}: plural {${plural.name}} needs ${missing.join(", ")} for ${locale}`,
        );
      }
    }
    return true;
  };
  for (const [key, text] of sourceText) {
    checkMessage(SOURCE_LOCALE_DIR, key, text);
  }

  // 3. Translations.
  for (const locale of localeDirs(root)) {
    if (locale === SOURCE_LOCALE_DIR) continue;
    for (const [ns, catalog] of readLocale(root, locale)) {
      const file = `${LOCALES_DIR}/${locale}/${ns}.json`;
      if (!isNamespace(ns)) {
        errors.push(`${file} names no namespace`);
        continue;
      }
      for (const [key, value] of Object.entries(catalog)) {
        const at = `${file}: "${key}"`;
        const source = sourceText.get(key);
        if (source === undefined) {
          errors.push(`${at} is not in the English source (remove it)`);
          continue;
        }
        const entry = value as { text?: unknown; src?: unknown };
        if (
          typeof value !== "object" ||
          value === null ||
          typeof entry.text !== "string" ||
          typeof entry.src !== "string"
        ) {
          errors.push(`${at} must be { "text": …, "src": … }`);
          continue;
        }
        if (!checkMessage(locale, key, entry.text)) continue;
        const want = [...messageArguments(source)].sort().join(", ");
        const have = [...messageArguments(entry.text)].sort().join(", ");
        if (want !== have) {
          errors.push(
            `${at}: placeholders [${have}] differ from English [${want}]`,
          );
        }
        if (entry.src !== sourceHash(source)) {
          warnings.push(`${at} is stale: its English has changed`);
        }
      }
    }
  }

  // 4. Reserved combos.
  const reserved = new Set(RESERVED_COMBOS.map((combo) => combo.toLowerCase()));
  for (const action of actions) {
    if (action.shortcut && reserved.has(action.shortcut.toLowerCase())) {
      errors.push(
        `lib/editor-actions (${action.id}): ${action.shortcut} is reserved`,
      );
    }
  }

  return { errors, warnings };
}

if (import.meta.main) {
  const root = join(import.meta.dir, "..", "..");
  const { errors, warnings } = checkCatalogs(root, {
    actions: await registryActions(),
  });
  if (warnings.length) console.warn(warnings.join("\n"));
  if (errors.length) {
    console.error(errors.join("\n"));
    process.exit(1);
  }
  console.log("i18n catalogs OK");
}
