/**
 * The eager message lookup (languages design §3.2, §3.3): `t(key, english,
 * values)` returns the active catalog's message, else the English source,
 * with `{name}` values filled in. No plural or select code lives here: lazy
 * chunks format those through `lib/i18n/format.ts`, and `check.ts` keeps the
 * `core` namespace (what the editor chunk renders) to `{name}` alone.
 *
 * English is the source of truth and needs no catalog, so in English `t()`
 * returns exactly the text in code. In another language, values are
 * isolated with FSI…PDI so a title in another script can't reorder the
 * sentence around it.
 *
 * Not imported by the app yet: L1a wires it in under its 400 B gz ledger
 * line (desktop details §1 rule 5). It imports only `dir.ts`, never
 * `locale.ts` (`tests/unit/i18n/editor-chunk-imports.test.ts`).
 *
 * The locale and catalog are module state, which suits the browser and
 * Electron renderers (one interface language per page). `setUiLocale` and
 * `addMessages` therefore run client-side at boot only: on the Next.js
 * server this state would be shared across requests, so server code must
 * not call them (L1a passes per-request state explicitly if it ever needs
 * translated server output).
 */
import { dirOf, SOURCE_LOCALE, type TextDirection } from "@/lib/i18n/dir";

let locale = SOURCE_LOCALE;
let dir: TextDirection = "ltr";
let messages: Record<string, string> = {};

/** The interface locale (set once at boot; a change applies on reload). */
export const uiLocale = (): string => locale;

/** The interface direction, from {@link uiLocale}. */
export const uiDir = (): TextDirection => dir;

/** Whether values are isolated: only outside the English source. */
export const shouldIsolate = (): boolean => locale !== SOURCE_LOCALE;

/** Sets the interface locale and drops any catalog of the previous one. */
export function setUiLocale(next: string): void {
  if (next === locale) return;
  locale = next;
  dir = dirOf(next);
  messages = {};
}

/** Merges a loaded namespace's messages. Ignored in English. */
export function addMessages(loaded: Readonly<Record<string, string>>): void {
  if (locale === SOURCE_LOCALE) return;
  messages = { ...messages, ...loaded };
}

/** The active catalog's message for `key`, if any. */
export const lookup = (key: string): string | undefined =>
  Object.hasOwn(messages, key) ? messages[key] : undefined;

const PLACEHOLDER = /\{\s*([A-Za-z_][\w-]*)\s*\}/g;

/** Looks up `key` and fills `{name}` values. English is the fallback. */
export function t(
  key: string,
  english: string,
  values?: Readonly<Record<string, string | number>>,
): string {
  const message = lookup(key) ?? english;
  if (!values) return message;
  const isolate = shouldIsolate();
  return message.replace(PLACEHOLDER, (whole, name: string) => {
    if (!Object.hasOwn(values, name)) return whole;
    const text = String(values[name]);
    return isolate ? `\u2068${text}\u2069` : text;
  });
}
