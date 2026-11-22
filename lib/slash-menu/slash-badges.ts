/**
 * "New" badges in the "/" menu (spec §8.5, BQ9). Declared here, in the
 * menu's lazy chunk, as item key (or action id) → last day shown,
 * "YYYY-MM-DD" in the writer's local date. At most two at a time, each at
 * most 60 days after its release. No storage of its own: a kind the
 * writer has inserted (`INSERT_KIND_CHOICE`'s recents) is not new to them.
 */
import { insertKindOf, type SlashItem } from "@/lib/slash-menu/slash-items";

/** Ships empty; the first feature that wants a badge adds its date. */
export const NEW_UNTIL: Readonly<Record<string, string>> = {};

/** At most this many badges at a time. */
export const MAX_NEW_BADGES = 2;

type BadgeWindow = { __SLASH_NEW_UNTIL?: Readonly<Record<string, string>> };

/** The table, or the e2e override outside production builds. */
function declared(): Readonly<Record<string, string>> {
  if (process.env.NODE_ENV === "production") return NEW_UNTIL;
  return (globalThis as BadgeWindow).__SLASH_NEW_UNTIL ?? NEW_UNTIL;
}

/** The local date as "YYYY-MM-DD", the form `NEW_UNTIL` uses. */
export function localDay(now = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/**
 * Whether `item` shows "New" on `today`: declared until `today` or later,
 * and not a kind in `recentKinds` (this writer has used it). A Suggested
 * copy follows its own row.
 */
export function isNewItem(
  item: SlashItem,
  today: string,
  recentKinds: readonly string[],
): boolean {
  const table = declared();
  const key = item.key.replace(/^suggested:/, "");
  const until = table[key] ?? table[item.actionId];
  if (!until || today > until) return false;
  const kind = insertKindOf(item);
  return !(kind && recentKinds.includes(kind));
}
