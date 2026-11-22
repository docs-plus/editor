/**
 * The registry render boundary (languages design §3.3). Action labels,
 * keywords and `Enabled` reasons stay English data in `lib/editor-actions`;
 * renderers translate them at the edge through these lookups, so the
 * per-label cost is zero and English needs no catalog.
 *
 * Keys (written by `scripts/i18n/extract.ts` into `locales/en/actions.json`
 * and, from L2a, `reasons.json`):
 * - `action.<id>.label`
 * - `action.<id>.keywords`: comma-separated search words (an ASCII comma,
 *   or the Arabic `،` and CJK `、` `，` a translator naturally types)
 * - `reason:<English text>`
 *
 * Not imported by the app yet: L1a adds the about 6 render sites.
 */
import { lookup } from "@/lib/i18n/t-core";

/** Keyword separators: ASCII, Arabic-script and CJK commas. */
const KEYWORD_SEPARATOR = /[,،、，]/;

interface LabelledAction {
  readonly id: string;
  readonly label: string;
  readonly keywords?: readonly string[];
}

/** The translated label, else the registry's English. */
export const actionLabel = (action: LabelledAction): string =>
  lookup(`action.${action.id}.label`) ?? action.label;

/** The translated search words, else the registry's English ones. */
export function actionKeywords(action: LabelledAction): readonly string[] {
  const translated = lookup(`action.${action.id}.keywords`);
  if (translated === undefined) return action.keywords ?? [];
  return translated
    .split(KEYWORD_SEPARATOR)
    .map((word) => word.trim())
    .filter(Boolean);
}

/** A disabled reason, looked up by its English text. */
export const reasonText = (english: string): string =>
  lookup(`reason:${english}`) ?? english;
