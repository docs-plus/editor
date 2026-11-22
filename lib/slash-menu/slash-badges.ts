/**
 * "New" badges in the "/" menu (spec §8.5, BQ9). Declared here, in the
 * menu's lazy chunk, as item key (or action id) → last day shown,
 * "YYYY-MM-DD" in the writer's local date. At most two at a time, each at
 * most 60 days after its release. No storage of its own: a kind the
 * writer has inserted (`INSERT_KIND_CHOICE`'s recents) is not new to them.
 */
import type { InsertKind } from "@/lib/remembered-choice";
import { insertKindOf, type SlashItem } from "@/lib/slash-menu/slash-items";

/** Ships empty; the first feature that wants a badge adds its date. */
export const NEW_UNTIL: Readonly<Record<string, string>> = {};

/** At most this many badges at a time. */
export const MAX_NEW_BADGES = 2;

/**
 * Set to true together with the first `NEW_UNTIL` entry (a unit test
 * keeps the two in step). A literal, so while it is false a production
 * build drops every badge path from the slash chunk; development builds
 * keep them for the e2e override.
 */
export const BADGES_DECLARED = false;

export const HAS_NEW_BADGES =
  BADGES_DECLARED || process.env.NODE_ENV !== "production";

type BadgeWindow = { __SLASH_NEW_UNTIL?: Readonly<Record<string, string>> };

/** The table, or the e2e override outside production builds. */
function declared(): Readonly<Record<string, string>> {
  if (process.env.NODE_ENV === "production") return NEW_UNTIL;
  return (globalThis as BadgeWindow).__SLASH_NEW_UNTIL ?? NEW_UNTIL;
}

/** The local date as "YYYY-MM-DD" (Swedish order), as `NEW_UNTIL` has it. */
export const localDay = (now = new Date()): string =>
  now.toLocaleDateString("sv-SE");

/**
 * Whether `item` shows "New" on `today`: declared until `today` or later,
 * and not a kind in `recentKinds` (this writer has used it). A Suggested
 * copy follows its own row.
 */
export function isNewItem(
  item: SlashItem,
  today: string,
  recentKinds: readonly InsertKind[],
): boolean {
  const table = declared();
  const key = item.key.replace(/^suggested:/, "");
  const until = table[key] ?? table[item.actionId];
  if (!until || today > until) return false;
  const kind = insertKindOf(item);
  return !(kind && recentKinds.includes(kind));
}
